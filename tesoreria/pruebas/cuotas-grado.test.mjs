/*
 * Candidatos en el padrón y cuotas de grado por cobrar: lo que una persona debe
 * a la logia por su iniciación, afiliación, aumento o exaltación, y cómo los
 * ingresos de esa cuota la van saldando solos.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { crearHermano, debeFallar, enPrueba } from './ayuda.mjs';

async function candidato(cliente, nombre) {
  const { rows } = await cliente.query(
    `insert into hermano (nombre_completo, estatus, candidato_para, motivo_ingreso)
     values ($1, 'candidato', 'iniciacion', 'iniciacion') returning id`,
    [nombre],
  );
  return rows[0].id;
}

async function cuota(cliente, hermanoId, tipo, monto, usuarioId, fecha = '2026-05-01') {
  const { rows } = await cliente.query(
    `insert into cuota_grado_cargo (hermano_id, tipo_evento, monto_centavos, fecha, creado_por)
     values ($1, $2, $3, $4, $5) returning id`,
    [hermanoId, tipo, monto, fecha, usuarioId],
  );
  return rows[0].id;
}

async function pagoCuota(cliente, hermanoId, tipo, monto, usuarioId, fecha = '2026-05-20') {
  const { rows } = await cliente.query(
    `insert into movimiento
       (fecha, ejercicio_anio, periodo, tipo, bolsa, concepto_id, monto_centavos,
        descripcion, hermano_id, creado_por)
     select $1, extract(year from $1::date)::int, date_trunc('month', $1::date)::date,
            'ingreso', 'efectivo', c.id, $2, 'Cuota de prueba', $3, $4
       from concepto c where c.clave = $5
     returning id`,
    [fecha, monto, hermanoId, usuarioId, `cuota_${tipo}`],
  );
  await cliente.query('set constraints all immediate');
  return rows[0].id;
}

const saldo = async (cliente, cargoId) => {
  const { rows } = await cliente.query(
    'select pagado_centavos, saldo_centavos from v_cuota_grado_saldo where id = $1',
    [cargoId],
  );
  return rows[0];
};

test('un candidato no tiene grado ni fecha de ingreso; un hermano sí', async () => {
  await enPrueba(async ({ cliente }) => {
    await candidato(cliente, 'Candidato de prueba');
    await debeFallar(
      cliente,
      () =>
        cliente.query(
          `insert into hermano (nombre_completo, estatus, candidato_para, grado)
           values ('Candidato con grado', 'candidato', 'iniciacion', 'aprendiz')`,
        ),
      /hermano_candidato_coherente|check constraint/i,
    );
    await debeFallar(
      cliente,
      () =>
        cliente.query(
          `insert into hermano (nombre_completo, estatus, fecha_ingreso)
           values ('Hermano sin grado', 'activo', '2026-01-01')`,
        ),
      /hermano_candidato_coherente|check constraint/i,
    );
  });
});

test('la cuota se salda sola con los ingresos de su concepto, en abonos', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const id = await candidato(cliente, 'Candidato que abona');
    const cargo = await cuota(cliente, id, 'iniciacion', 450000, tesorero);
    assert.deepEqual(await saldo(cliente, cargo), { pagado_centavos: 0, saldo_centavos: 450000 });

    await pagoCuota(cliente, id, 'iniciacion', 200000, tesorero);
    assert.deepEqual(await saldo(cliente, cargo), {
      pagado_centavos: 200000,
      saldo_centavos: 250000,
    });

    /* Un ingreso de otro tipo no salda la de iniciación. */
    await pagoCuota(cliente, id, 'exaltacion', 100000, tesorero);
    assert.equal((await saldo(cliente, cargo)).saldo_centavos, 250000);

    /* Lo que sobra del ingreso no se cuenta de más. */
    await pagoCuota(cliente, id, 'iniciacion', 300000, tesorero);
    assert.deepEqual(await saldo(cliente, cargo), {
      pagado_centavos: 450000,
      saldo_centavos: 0,
    });
  });
});

test('una cuota registrada después recoge los pagos que ya existían', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const id = await crearHermano(cliente, 'Hermano que pagó antes', '2026-05-11', 'aprendiz');
    await pagoCuota(cliente, id, 'iniciacion', 150000, tesorero);
    const cargo = await cuota(cliente, id, 'iniciacion', 450000, tesorero);
    await cliente.query('set constraints all immediate');
    assert.equal((await saldo(cliente, cargo)).pagado_centavos, 150000);
  });
});

test('una cuota con pagos no se cancela; sin pagos, sí, con motivo', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const id = await crearHermano(cliente, 'Hermano con exaltación', '2025-01-01', 'companero');
    const conPago = await cuota(cliente, id, 'exaltacion', 300000, tesorero);
    await pagoCuota(cliente, id, 'exaltacion', 100000, tesorero);

    await debeFallar(
      cliente,
      () =>
        cliente.query(
          "update cuota_grado_cargo set estatus = 'cancelado', motivo_cancelacion = 'x' where id = $1",
          [conPago],
        ),
      /pagos aplicados/i,
    );

    const sinPago = await cuota(cliente, id, 'aumento_salario', 200000, tesorero);
    await cliente.query(
      "update cuota_grado_cargo set estatus = 'cancelado', motivo_cancelacion = 'Error de captura' where id = $1",
      [sinPago],
    );
    await debeFallar(
      cliente,
      () => cliente.query('delete from cuota_grado_cargo where id = $1', [sinPago]),
      /no se borran/i,
    );
  });
});
