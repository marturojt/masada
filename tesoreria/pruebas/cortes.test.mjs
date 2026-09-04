/*
 * Cortes mensuales: saldos encadenados, bloqueo del mes cerrado y ajustes.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { debeFallar, enPrueba, crearHermano } from './ayuda.mjs';

async function ingreso(cliente, fecha, centavos, usuarioId, clave = 'donativo', bolsa = 'banco') {
  const { rows: concepto } = await cliente.query(
    'select id from concepto where clave = $1',
    [clave],
  );
  const { rows } = await cliente.query(
    `insert into movimiento
       (fecha, ejercicio_anio, periodo, tipo, bolsa, concepto_id, monto_centavos,
        descripcion, creado_por)
     values ($1, $2, date_trunc('month', $1::date)::date, 'ingreso', $6, $3, $4, 'Prueba', $5)
     returning id`,
    [fecha, Number(fecha.slice(0, 4)), concepto[0].id, centavos, usuarioId, bolsa],
  );
  return Number(rows[0].id);
}

test('el saldo final de un mes es el inicial del siguiente', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    await cliente.query(
      'update ejercicio set apertura_banco_centavos = 500000 where anio = 2026',
    );
    await ingreso(cliente, '2026-01-10', 100000, vm);
    await ingreso(cliente, '2026-02-10', 50000, vm);

    await cliente.query('select fn_cerrar_corte($1)', ['2026-01-01']);
    await cliente.query('select fn_cerrar_corte($1)', ['2026-02-01']);

    const { rows } = await cliente.query(
      `select to_char(periodo, 'YYYY-MM') as mes, saldo_inicial_centavos,
              saldo_final_centavos
         from corte_mensual order by periodo`,
    );
    assert.deepEqual(rows, [
      { mes: '2026-01', saldo_inicial_centavos: 500000, saldo_final_centavos: 600000 },
      { mes: '2026-02', saldo_inicial_centavos: 600000, saldo_final_centavos: 650000 },
    ]);
  });
});

test('los cortes se cierran en orden', async () => {
  await enPrueba(async ({ cliente }) => {
    await debeFallar(
      cliente,
      () =>
        cliente.query('select fn_cerrar_corte($1)', ['2026-03-01']),
      /Antes hay que cerrar el mes de febrero/i,
    );
  });
});

test('un mes cerrado no admite movimientos nuevos', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    await ingreso(cliente, '2026-01-10', 100000, vm);
    await cliente.query('select fn_cerrar_corte($1)', ['2026-01-01']);

    await debeFallar(
      cliente,
      () =>
        ingreso(cliente, '2026-01-20', 50000, vm),
      /ya tiene corte cerrado/i,
    );
  });
});

test('cerrar sella los movimientos del mes con su corte', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    const movimiento = await ingreso(cliente, '2026-01-10', 100000, vm);
    const { rows } = await cliente.query('select fn_cerrar_corte($1) as id', ['2026-01-01']);

    const { rows: sellado } = await cliente.query(
      'select corte_id from movimiento where id = $1',
      [movimiento],
    );
    assert.equal(Number(sellado[0].corte_id), Number(rows[0].id));
  });
});

test('no se cierra un mes con dinero por comprobar arrastrado', async () => {
  await enPrueba(async ({ cliente, tesorero, vm }) => {
    const { rows: concepto } = await cliente.query(
      "select id from concepto where clave = 'agape'",
    );
    const { rows: folio } = await cliente.query('select fn_siguiente_folio(2026) as folio');
    const { rows: egreso } = await cliente.query(
      `insert into egreso
         (folio, fecha_solicitud, ejercicio_anio, concepto_id, beneficiario, descripcion,
          monto_solicitado_centavos, requiere_comprobacion, estado,
          monto_autorizado_centavos, creado_por, actualizado_por)
       values ($1, '2026-01-05', 2026, $2, 'Proveedor', 'Vino', 300000, true, 'autorizado',
               300000, $3, $3)
       returning id`,
      [folio[0].folio, concepto[0].id, tesorero],
    );
    await cliente.query(
      `update egreso set estado = 'por_comprobar', monto_entregado_centavos = 300000,
              fecha_entrega = '2026-01-06' where id = $1`,
      [egreso[0].id],
    );

    /* El mes de la entrega sí se puede cerrar: el gasto es fresco. */
    await cliente.query('select fn_cerrar_corte($1)', ['2026-01-01']);

    /* El siguiente no, mientras siga sin comprobarse. */
    await debeFallar(
      cliente,
      () =>
        cliente.query('select fn_cerrar_corte($1)', ['2026-02-01']),
      /sigue por comprobar/i,
    );
  });
});

test('la reapertura solo alcanza al último mes cerrado y deja huella', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    await ingreso(cliente, '2026-01-10', 100000, vm);
    const { rows: enero } = await cliente.query('select fn_cerrar_corte($1) as id', [
      '2026-01-01',
    ]);
    await cliente.query('select fn_cerrar_corte($1)', ['2026-02-01']);

    await debeFallar(
      cliente,
      () =>
        cliente.query('select fn_reabrir_corte($1, $2, $3)', [
          enero[0].id,
          'Intento fuera de orden',
          vm,
        ]),
      /último mes cerrado/i,
    );

    const { rows: febrero } = await cliente.query(
      "select id from corte_mensual where periodo = '2026-02-01'",
    );
    await cliente.query('select fn_reabrir_corte($1, $2, $3)', [
      febrero[0].id,
      'Faltó capturar un donativo',
      vm,
    ]);

    const { rows: estado } = await cliente.query(
      'select estado, reaperturas from corte_mensual where id = $1',
      [febrero[0].id],
    );
    assert.equal(estado[0].estado, 'abierto');
    assert.equal(estado[0].reaperturas, 1);

    const { rows: huella } = await cliente.query(
      'select motivo from corte_reapertura where corte_id = $1',
      [febrero[0].id],
    );
    assert.match(huella[0].motivo, /donativo/);
  });
});

test('reabrir quita el sello de los movimientos', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    const movimiento = await ingreso(cliente, '2026-01-10', 100000, vm);
    const { rows: corte } = await cliente.query('select fn_cerrar_corte($1) as id', [
      '2026-01-01',
    ]);
    await cliente.query('select fn_reabrir_corte($1, $2, $3)', [
      corte[0].id,
      'Corrección',
      vm,
    ]);

    const { rows } = await cliente.query('select corte_id from movimiento where id = $1', [
      movimiento,
    ]);
    assert.equal(rows[0].corte_id, null);
  });
});

test('los ajustes acumulados no pueden pasar del movimiento original', async () => {
  await enPrueba(async ({ cliente, tesorero, vm }) => {
    const { rows: concepto } = await cliente.query(
      "select id from concepto where clave = 'cuota_iniciacion'",
    );
    /* El ajuste de un ingreso es un egreso: su concepto es ajuste_ingreso. */
    const { rows: conceptoAjuste } = await cliente.query(
      "select id from concepto where clave = 'ajuste_ingreso'",
    );
    const hermano = await crearHermano(cliente, 'Hermano Doble Ajuste', '2025-12-31');
    const { rows: mov } = await cliente.query(
      `insert into movimiento (fecha, ejercicio_anio, periodo, tipo, bolsa, concepto_id,
         monto_centavos, descripcion, hermano_id, creado_por)
       values ('2026-04-27', 2026, '2026-04-01', 'ingreso', 'banco', $1, 450000,
               'Cuota capturada de más', $2, $3) returning id`,
      [concepto[0].id, hermano, tesorero],
    );

    const ajustar = async (centavos) => {
      const { rows: a } = await cliente.query(
        `insert into movimiento (fecha, ejercicio_anio, periodo, tipo, bolsa, concepto_id,
           monto_centavos, descripcion, creado_por)
         values ('2026-09-02', 2026, '2026-09-01', 'egreso', 'banco', $1, $2,
                 'Ajuste de prueba', $3) returning id`,
        [conceptoAjuste[0].id, centavos, vm],
      );
      await cliente.query(
        `insert into movimiento_ajuste
           (movimiento_ajuste_id, movimiento_origen_id, motivo, autorizado_por)
         values ($1, $2, 'Estaba mal capturado', $3)`,
        [a[0].id, mov[0].id, vm],
      );
    };

    /* El primer ajuste de 4,250 entra (aunque el correcto era 250)... */
    await ajustar(425000);
    /* ...pero el segundo, que dejaría el neto en -4,000, ya no. */
    await debeFallar(cliente, () => ajustar(425000), /no puede dejarlo en negativo/);
    /* Uno chico que sí cabe (250 restantes) pasa. */
    await ajustar(25000);
  });
});

test('la dispensa de evidencia es única por registro y exige motivo', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    const { rows: concepto } = await cliente.query(
      "select id from concepto where clave = 'donativo'",
    );
    const { rows: mov } = await cliente.query(
      `insert into movimiento (fecha, ejercicio_anio, periodo, tipo, bolsa, concepto_id,
         monto_centavos, descripcion, creado_por)
       values ('2026-08-10', 2026, '2026-08-01', 'ingreso', 'efectivo', $1, 30000,
               'Donativo sin comprobante', $2) returning id`,
      [concepto[0].id, vm],
    );

    await debeFallar(
      cliente,
      () =>
        cliente.query(
          `insert into evidencia_dispensa (entidad, entidad_id, motivo, creado_por)
           values ('movimiento', $1, '   ', $2)`,
          [mov[0].id, vm],
        ),
      /dispensa_motivo_no_vacio/,
    );

    await cliente.query(
      `insert into evidencia_dispensa (entidad, entidad_id, motivo, creado_por)
       values ('movimiento', $1, 'Donativo en efectivo de la tenida, sin recibo', $2)`,
      [mov[0].id, vm],
    );
    await debeFallar(
      cliente,
      () =>
        cliente.query(
          `insert into evidencia_dispensa (entidad, entidad_id, motivo, creado_por)
           values ('movimiento', $1, 'Otra vez', $2)`,
          [mov[0].id, vm],
        ),
      /duplicate key/,
    );
  });
});
