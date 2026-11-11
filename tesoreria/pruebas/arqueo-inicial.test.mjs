/*
 * Arranque del control por bolsa a medio ejercicio: el arqueo inicial acomoda
 * banco y efectivo a lo contado sin mover el total, y el mes de arranque no se
 * cierra sin él.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { debeFallar, enPrueba } from './ayuda.mjs';

async function movimiento(cliente, fecha, tipo, bolsa, centavos, usuarioId) {
  const { rows: concepto } = await cliente.query(
    'select id from concepto where clave = $1',
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

const arqueo = (cliente, fecha, banco, efectivo, usuarioId) =>
  cliente.query('select fn_registrar_arqueo_inicial(2026, $1, $2, $3, $4) as traspaso_id', [
    fecha,
    banco,
    efectivo,
    usuarioId,
  ]);

async function cerrarHasta(cliente, mes) {
  for (let m = 1; m <= mes; m++) {
    await cliente.query('select fn_cerrar_corte($1)', [`2026-${String(m).padStart(2, '0')}-01`]);
  }
}

test('el arqueo acomoda las bolsas a lo contado y el total no cambia', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    await cliente.query(
      `update ejercicio
          set apertura_banco_centavos = 0, apertura_efectivo_centavos = 0,
              bolsas_desde = '2026-03-01'
        where anio = 2026`,
    );
    /* Todo se capturó "en efectivo", pero en realidad casi todo está en el banco. */
    await movimiento(cliente, '2026-01-10', 'ingreso', 'efectivo', 100000, tesorero);
    await movimiento(cliente, '2026-02-10', 'egreso', 'efectivo', 30000, tesorero);
    await cerrarHasta(cliente, 2);

    const { rows } = await arqueo(cliente, '2026-03-05', 60000, 10000, tesorero);
    assert.ok(rows[0].traspaso_id);

    const { rows: t } = await cliente.query(
      'select de_bolsa, a_bolsa, monto_centavos from traspaso where id = $1',
      [rows[0].traspaso_id],
    );
    assert.deepEqual(t[0], { de_bolsa: 'efectivo', a_bolsa: 'banco', monto_centavos: 60000 });

    await cliente.query('select fn_cerrar_corte($1)', ['2026-03-01']);
    const { rows: c } = await cliente.query(
      `select saldo_final_centavos, banco_final_centavos, efectivo_final_centavos,
              total_ingresos_centavos, total_egresos_centavos
         from corte_mensual where periodo = '2026-03-01'`,
    );
    assert.equal(c[0].saldo_final_centavos, 70000);
    assert.equal(c[0].banco_final_centavos, 60000);
    assert.equal(c[0].efectivo_final_centavos, 10000);
    assert.equal(c[0].total_ingresos_centavos, 0);
    assert.equal(c[0].total_egresos_centavos, 0);
  });
});

test('si lo contado no suma el total del sistema, el arqueo se rechaza', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    await cliente.query(
      `update ejercicio
          set apertura_banco_centavos = 50000, apertura_efectivo_centavos = 0,
              bolsas_desde = '2026-03-01'
        where anio = 2026`,
    );
    await debeFallar(
      cliente,
      () => arqueo(cliente, '2026-03-05', 40000, 5000, tesorero),
      /el sistema tiene/i,
    );
  });
});

test('el mes de arranque no se cierra sin arqueo, y el arqueo es uno solo', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    await cliente.query(
      `update ejercicio
          set apertura_banco_centavos = 50000, apertura_efectivo_centavos = 0,
              bolsas_desde = '2026-02-01'
        where anio = 2026`,
    );
    await cerrarHasta(cliente, 1);
    await debeFallar(
      cliente,
      () => cliente.query('select fn_cerrar_corte($1)', ['2026-02-01']),
      /arqueo inicial/i,
    );

    /* Lo contado coincide con lo que trae el sistema: no hace falta traspaso. */
    const { rows } = await arqueo(cliente, '2026-02-03', 50000, 0, tesorero);
    assert.equal(rows[0].traspaso_id, null);

    await debeFallar(
      cliente,
      () => arqueo(cliente, '2026-02-04', 50000, 0, tesorero),
      /ya tiene arqueo inicial/i,
    );
    await debeFallar(
      cliente,
      () => cliente.query('delete from arqueo_inicial where true'),
      /no se borran/i,
    );
    await cliente.query('select fn_cerrar_corte($1)', ['2026-02-01']);
  });
});

test('el arqueo va en el mes de arranque y no en otro', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    await cliente.query("update ejercicio set bolsas_desde = '2026-03-01' where anio = 2026");
    await debeFallar(
      cliente,
      () => arqueo(cliente, '2026-04-02', 0, 0, tesorero),
      /va en el mes de/i,
    );
  });
});
