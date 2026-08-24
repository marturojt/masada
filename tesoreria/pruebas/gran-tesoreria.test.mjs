/*
 * Dominio Gran Tesorería: obligaciones, pagos, aplicaciones y estado a plomo.
 * La regla central: lo exigible es lo que GT reporta; el cálculo interno solo
 * concilia. Y ningún pago GT existe sin movimiento real en el libro de caja.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { debeFallar, enPrueba } from './ayuda.mjs';

/** Obligación mínima con lo que GT reporta. */
async function nuevaObligacion(cliente, usuarioId, opciones = {}) {
  const tipo = opciones.tipo ?? 'ordinaria';
  const anio = opciones.anio ?? 2026;
  const { rows: folio } = await cliente.query(
    'select fn_gt_folio_obligacion($1, $2) as folio',
    [anio, tipo],
  );
  const { rows } = await cliente.query(
    `insert into gt_obligacion
       (folio, tipo, periodo_desde, periodo_hasta, fecha_documento,
        monto_reportado_centavos, monto_esperado_centavos, creado_por, actualizado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     returning id, folio, estatus`,
    [
      folio[0].folio,
      tipo,
      opciones.desde ?? '2026-01-01',
      opciones.hasta ?? '2026-01-01',
      opciones.fecha ?? '2026-01-15',
      opciones.monto ?? 100000,
      opciones.esperado ?? null,
      usuarioId,
    ],
  );
  return rows[0];
}

/** Pago GT con su movimiento de egreso, como lo materializa la entrega. */
async function nuevoPagoGT(cliente, usuarioId, montoCentavos, fecha = '2026-01-20') {
  const { rows: concepto } = await cliente.query(
    "select id from concepto where clave = 'gran_tesoreria'",
  );
  const { rows: mov } = await cliente.query(
    `insert into movimiento
       (fecha, ejercicio_anio, periodo, tipo, bolsa, concepto_id, monto_centavos,
        descripcion, creado_por)
     values ($1, $2, date_trunc('month', $1::date)::date, 'egreso', 'banco', $3, $4,
             'Pago GT de prueba', $5)
     returning id`,
    [fecha, Number(fecha.slice(0, 4)), concepto[0].id, montoCentavos, usuarioId],
  );
  const { rows: folio } = await cliente.query('select fn_gt_folio_pago($1) as folio', [
    Number(fecha.slice(0, 4)),
  ]);
  const { rows } = await cliente.query(
    `insert into gt_pago (folio, fecha_pago, monto_centavos, bolsa, medio_pago,
                          movimiento_id, creado_por)
     values ($1, $2, $3, 'banco', 'transferencia', $4, $5)
     returning id, folio`,
    [folio[0].folio, fecha, montoCentavos, mov[0].id, usuarioId],
  );
  return rows[0];
}

const aplicar = (cliente, pagoId, obligacionId, monto, usuarioId) =>
  cliente.query(
    `insert into gt_pago_aplicacion (pago_id, obligacion_id, monto_centavos, creado_por)
     values ($1, $2, $3, $4)`,
    [pagoId, obligacionId, monto, usuarioId],
  );

test('el folio de la obligación depende del tipo: GT- ordinarias, REG- regularizaciones', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const ordinaria = await nuevaObligacion(cliente, tesorero, { tipo: 'ordinaria' });
    const regularizacion = await nuevaObligacion(cliente, tesorero, {
      tipo: 'regularizacion',
      desde: '2024-05-01',
      hasta: '2024-12-01',
    });
    assert.match(ordinaria.folio, /^GT-2026-\d{4}$/);
    assert.match(regularizacion.folio, /^REG-2026-\d{4}$/);
    assert.equal(ordinaria.estatus, 'pendiente_pago');
  });
});

test('un pago GT sin movimiento en el libro no existe', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const { rows: folio } = await cliente.query('select fn_gt_folio_pago(2026) as folio');
    await debeFallar(
      cliente,
      () =>
        cliente.query(
          `insert into gt_pago (folio, fecha_pago, monto_centavos, bolsa, movimiento_id, creado_por)
           values ($1, '2026-01-20', 100000, 'banco', null, $2)`,
          [folio[0].folio, tesorero],
        ),
      /not-null|null value/i,
    );
  });
});

test('no se puede aplicar más que el monto de la obligación', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const obligacion = await nuevaObligacion(cliente, tesorero, { monto: 100000 });
    const pago = await nuevoPagoGT(cliente, tesorero, 150000);

    await debeFallar(
      cliente,
      async () => {
        await aplicar(cliente, pago.id, obligacion.id, 150000, tesorero);
        await cliente.query('set constraints all immediate');
      },
      /aplicando .* a una obligación/i,
    );
  });
});

test('no se puede aplicar más que el monto del pago', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const obligacion = await nuevaObligacion(cliente, tesorero, { monto: 300000 });
    const pago = await nuevoPagoGT(cliente, tesorero, 100000);

    await debeFallar(
      cliente,
      async () => {
        await aplicar(cliente, pago.id, obligacion.id, 200000, tesorero);
        await cliente.query('set constraints all immediate');
      },
      /el pago GT fue de/i,
    );
  });
});

test('el estatus se deriva de las aplicaciones: parcial y luego pagada', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const obligacion = await nuevaObligacion(cliente, tesorero, { monto: 100000 });

    const parcial = await nuevoPagoGT(cliente, tesorero, 40000);
    await aplicar(cliente, parcial.id, obligacion.id, 40000, tesorero);
    await cliente.query('set constraints all immediate');

    let { rows } = await cliente.query('select estatus from gt_obligacion where id = $1', [
      obligacion.id,
    ]);
    assert.equal(rows[0].estatus, 'parcialmente_pagada');

    const resto = await nuevoPagoGT(cliente, tesorero, 60000, '2026-01-25');
    await aplicar(cliente, resto.id, obligacion.id, 60000, tesorero);
    await cliente.query('set constraints all immediate');

    ({ rows } = await cliente.query('select estatus from gt_obligacion where id = $1', [
      obligacion.id,
    ]));
    assert.equal(rows[0].estatus, 'pagada');
  });
});

test('una obligación con pagos no se cancela ni cambia de monto', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const obligacion = await nuevaObligacion(cliente, tesorero, { monto: 100000 });
    const pago = await nuevoPagoGT(cliente, tesorero, 100000);
    await aplicar(cliente, pago.id, obligacion.id, 100000, tesorero);
    await cliente.query('set constraints all immediate');

    await debeFallar(
      cliente,
      () =>
        cliente.query('update gt_obligacion set monto_reportado_centavos = 50000 where id = $1', [
          obligacion.id,
        ]),
      /ya tiene pagos aplicados/i,
    );
    await debeFallar(
      cliente,
      () =>
        cliente.query("update gt_obligacion set estatus = 'cancelada' where id = $1", [
          obligacion.id,
        ]),
      /tiene pagos aplicados, no se puede cancelar/i,
    );
  });
});

test('una obligación cancelada no admite pagos', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const obligacion = await nuevaObligacion(cliente, tesorero, { monto: 100000 });
    await cliente.query(
      "update gt_obligacion set estatus = 'cancelada', motivo_cancelacion = 'Sustituida' where id = $1",
      [obligacion.id],
    );
    const pago = await nuevoPagoGT(cliente, tesorero, 100000);

    await debeFallar(
      cliente,
      async () => {
        await aplicar(cliente, pago.id, obligacion.id, 100000, tesorero);
        await cliente.query('set constraints all immediate');
      },
      /cancelada, no admite pagos/i,
    );
  });
});

test('el estado a plomo refleja los meses ordinarios cubiertos', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    /* Sin obligaciones ordinarias del año no hay meses exigidos: a plomo. */
    let { rows } = await cliente.query('select * from v_gt_estado_aplomo');
    const base = rows[0];

    /* Una ordinaria de enero sin pagar, con enero ya en el pasado: deja de estar a plomo. */
    await nuevaObligacion(cliente, tesorero, {
      tipo: 'ordinaria',
      desde: '2026-01-01',
      hasta: '2026-01-01',
      monto: 100000,
    });
    ({ rows } = await cliente.query('select * from v_gt_estado_aplomo'));
    assert.equal(rows[0].ordinario_a_plomo, false);
    assert.equal(rows[0].primer_pendiente.slice(0, 7), '2026-01');
    assert.ok(rows[0].meses_pendientes >= 1);

    /* Pagada por completo, vuelve a plomo (respecto al estado base). */
    const obligacionId = (
      await cliente.query(
        "select id from gt_obligacion where tipo = 'ordinaria' order by id desc limit 1",
      )
    ).rows[0].id;
    const pago = await nuevoPagoGT(cliente, tesorero, 100000);
    await aplicar(cliente, pago.id, obligacionId, 100000, tesorero);
    await cliente.query('set constraints all immediate');

    ({ rows } = await cliente.query('select * from v_gt_estado_aplomo'));
    assert.equal(rows[0].ordinario_a_plomo, base.ordinario_a_plomo);
  });
});

test('una regularización pendiente cuenta aparte y no rompe lo ordinario', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const { rows: antes } = await cliente.query('select * from v_gt_estado_aplomo');
    await nuevaObligacion(cliente, tesorero, {
      tipo: 'regularizacion',
      desde: '2024-03-01',
      hasta: '2024-12-01',
      monto: 500000,
    });
    const { rows: despues } = await cliente.query('select * from v_gt_estado_aplomo');
    assert.equal(
      despues[0].regularizaciones_pendientes,
      antes[0].regularizaciones_pendientes + 1,
    );
    assert.equal(despues[0].ordinario_a_plomo, antes[0].ordinario_a_plomo);
  });
});

test('las tarifas GT no se editan: se capturan nuevas', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const { rows } = await cliente.query(
      `insert into gt_tarifa (concepto, monto_centavos, vigencia_desde, creado_por)
       values ('capita', 20000, current_date, $1) returning id`,
      [tesorero],
    );
    await debeFallar(
      cliente,
      () =>
        cliente.query('update gt_tarifa set monto_centavos = 25000 where id = $1', [rows[0].id]),
      /no se edita|inmutable|no se modifica/i,
    );
  });
});
