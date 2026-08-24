/*
 * Dos bolsas: los saldos por bolsa de los cortes, los traspasos y su bloqueo.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { debeFallar, enPrueba } from './ayuda.mjs';

async function movimiento(cliente, fecha, tipo, bolsa, centavos, usuarioId) {
  const { rows: concepto } = await cliente.query(
    "select id from concepto where clave = $1",
    [tipo === 'ingreso' ? 'donativo' : 'templo'],
  );
  await cliente.query(
    `insert into movimiento
       (fecha, ejercicio_anio, periodo, tipo, bolsa, concepto_id, monto_centavos,
        descripcion, creado_por)
     values ($1, $2, date_trunc('month', $1::date)::date, $3, $4, $5, $6, 'Prueba', $7)`,
    [fecha, Number(fecha.slice(0, 4)), tipo, bolsa, concepto[0].id, centavos, usuarioId],
  );
}

const traspaso = (cliente, fecha, de, a, centavos, usuarioId) =>
  cliente.query(
    `insert into traspaso
       (fecha, ejercicio_anio, periodo, de_bolsa, a_bolsa, monto_centavos, descripcion,
        creado_por)
     values ($1, $2, date_trunc('month', $1::date)::date, $3, $4, $5, 'Prueba', $6)`,
    [fecha, Number(fecha.slice(0, 4)), de, a, centavos, usuarioId],
  );

test('el corte separa banco y efectivo, y el traspaso mueve sin cambiar el total', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    await cliente.query(
      `update ejercicio
          set apertura_banco_centavos = 100000, apertura_efectivo_centavos = 50000
        where anio = 2026`,
    );
    /* Enero: cápita en efectivo 30,000, donativo por banco 20,000,
       egreso por banco 40,000, y depósito de 60,000 del efectivo al banco. */
    await movimiento(cliente, '2026-01-05', 'ingreso', 'efectivo', 30000, vm);
    await movimiento(cliente, '2026-01-10', 'ingreso', 'banco', 20000, vm);
    await movimiento(cliente, '2026-01-15', 'egreso', 'banco', 40000, vm);
    await traspaso(cliente, '2026-01-20', 'efectivo', 'banco', 60000, vm);

    await cliente.query('select fn_cerrar_corte($1)', ['2026-01-01']);

    const { rows } = await cliente.query(
      `select banco_inicial_centavos, banco_final_centavos,
              efectivo_inicial_centavos, efectivo_final_centavos,
              saldo_final_centavos, total_ingresos_centavos, total_egresos_centavos
         from corte_mensual where periodo = '2026-01-01'`,
    );
    const c = rows[0];
    assert.equal(c.banco_inicial_centavos, 100000);
    assert.equal(c.efectivo_inicial_centavos, 50000);
    /* Banco: 100,000 + 20,000 - 40,000 + 60,000 = 140,000 */
    assert.equal(c.banco_final_centavos, 140000);
    /* Efectivo: 50,000 + 30,000 - 60,000 = 20,000 */
    assert.equal(c.efectivo_final_centavos, 20000);
    assert.equal(c.saldo_final_centavos, 160000);
    /* El traspaso no infla ingresos ni egresos. */
    assert.equal(c.total_ingresos_centavos, 50000);
    assert.equal(c.total_egresos_centavos, 40000);
  });
});

test('las bolsas encadenan al mes siguiente', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    await cliente.query(
      `update ejercicio
          set apertura_banco_centavos = 100000, apertura_efectivo_centavos = 0
        where anio = 2026`,
    );
    await movimiento(cliente, '2026-01-05', 'ingreso', 'efectivo', 30000, vm);
    await cliente.query('select fn_cerrar_corte($1)', ['2026-01-01']);
    await movimiento(cliente, '2026-02-05', 'egreso', 'banco', 10000, vm);
    await cliente.query('select fn_cerrar_corte($1)', ['2026-02-01']);

    const { rows } = await cliente.query(
      `select banco_inicial_centavos, banco_final_centavos,
              efectivo_inicial_centavos, efectivo_final_centavos
         from corte_mensual where periodo = '2026-02-01'`,
    );
    assert.equal(rows[0].banco_inicial_centavos, 100000);
    assert.equal(rows[0].efectivo_inicial_centavos, 30000);
    assert.equal(rows[0].banco_final_centavos, 90000);
    assert.equal(rows[0].efectivo_final_centavos, 30000);
  });
});

test('un mes cerrado tampoco admite traspasos', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    await cliente.query('select fn_cerrar_corte($1)', ['2026-01-01']);
    await debeFallar(
      cliente,
      () => traspaso(cliente, '2026-01-15', 'efectivo', 'banco', 10000, vm),
      /ya tiene corte cerrado/i,
    );
  });
});

test('los traspasos no se borran y las bolsas deben ser distintas', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    await traspaso(cliente, '2026-01-15', 'efectivo', 'banco', 10000, vm);
    await debeFallar(
      cliente,
      () => cliente.query('delete from traspaso where true'),
      /no se borran/i,
    );
    await debeFallar(
      cliente,
      () => traspaso(cliente, '2026-01-16', 'banco', 'banco', 5000, vm),
      /traspaso_bolsas_distintas|check constraint/i,
    );
  });
});

test('el arrastre de diciembre lleva las dos bolsas al año nuevo', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    await cliente.query(
      `update ejercicio
          set apertura_banco_centavos = 80000, apertura_efectivo_centavos = 20000
        where anio = 2026`,
    );
    await cliente.query('select fn_abrir_ejercicio(2027, null, null)');
    await movimiento(cliente, '2026-03-05', 'ingreso', 'efectivo', 5000, vm);
    for (let mes = 1; mes <= 12; mes += 1) {
      await cliente.query('select fn_cerrar_corte($1)', [
        `2026-${String(mes).padStart(2, '0')}-01`,
      ]);
    }
    const { rows } = await cliente.query(
      `select apertura_banco_centavos, apertura_efectivo_centavos
         from ejercicio where anio = 2027`,
    );
    assert.equal(rows[0].apertura_banco_centavos, 80000);
    assert.equal(rows[0].apertura_efectivo_centavos, 25000);
  });
});
