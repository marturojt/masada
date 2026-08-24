/*
 * Apertura y cierre de ejercicios, y el arrastre del saldo de diciembre.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { debeFallar, enPrueba } from './ayuda.mjs';

test('abrir 2027 hereda tarifas y avisa que falta diciembre', async () => {
  await enPrueba(async ({ cliente }) => {
    await cliente.query('select fn_abrir_ejercicio(2027, null, null)');
    const { rows } = await cliente.query(
      `select capita_mensual_centavos, capita_promocion_centavos,
              saldo_apertura_centavos, notas
         from ejercicio where anio = 2027`,
    );
    assert.equal(rows[0].capita_mensual_centavos, 50000);
    assert.equal(rows[0].capita_promocion_centavos, 500000);
    assert.equal(rows[0].saldo_apertura_centavos, 0);
    assert.match(rows[0].notas, /Abierto antes de cerrar diciembre/);
  });
});

test('abrir 2027 con tarifas nuevas las respeta', async () => {
  await enPrueba(async ({ cliente }) => {
    await cliente.query('select fn_abrir_ejercicio(2027, 55000, 550000)');
    const { rows } = await cliente.query(
      'select capita_mensual_centavos, capita_promocion_centavos from ejercicio where anio = 2027',
    );
    assert.equal(rows[0].capita_mensual_centavos, 55000);
    assert.equal(rows[0].capita_promocion_centavos, 550000);
  });
});

test('no se puede abrir un año salteado ni repetido', async () => {
  await enPrueba(async ({ cliente }) => {
    await debeFallar(
      cliente,
      () => cliente.query('select fn_abrir_ejercicio(2028, null, null)'),
      /falta el 2027/i,
    );
    await debeFallar(
      cliente,
      () => cliente.query('select fn_abrir_ejercicio(2026, null, null)'),
      /ya existe/i,
    );
  });
});

test('cerrar diciembre arrastra la apertura al año ya abierto', async () => {
  await enPrueba(async ({ cliente }) => {
    await cliente.query(
      'update ejercicio set apertura_banco_centavos = 100000 where anio = 2026',
    );
    await cliente.query('select fn_abrir_ejercicio(2027, null, null)');

    /* Cierra los doce meses de 2026, en orden y sin movimientos. */
    for (let mes = 1; mes <= 12; mes += 1) {
      await cliente.query('select fn_cerrar_corte($1)', [
        `2026-${String(mes).padStart(2, '0')}-01`,
      ]);
    }

    const { rows } = await cliente.query(
      `select saldo_apertura_centavos, apertura_banco_centavos
         from ejercicio where anio = 2027`,
    );
    assert.equal(rows[0].saldo_apertura_centavos, 100000);
    assert.equal(rows[0].apertura_banco_centavos, 100000);
  });
});

test('el ejercicio solo cierra con los doce cortes cerrados', async () => {
  await enPrueba(async ({ cliente }) => {
    await debeFallar(
      cliente,
      () => cliente.query('select fn_cerrar_ejercicio(2026)'),
      /corte\(s\) cerrados de 12/i,
    );

    for (let mes = 1; mes <= 12; mes += 1) {
      await cliente.query('select fn_cerrar_corte($1)', [
        `2026-${String(mes).padStart(2, '0')}-01`,
      ]);
    }
    await cliente.query('select fn_cerrar_ejercicio(2026)');
    const { rows } = await cliente.query(
      "select estado from ejercicio where anio = 2026",
    );
    assert.equal(rows[0].estado, 'cerrado');
  });
});

test('las tarifas de grado no se editan ni se borran', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    await cliente.query(
      `insert into tarifa_grado (tipo_evento, monto_centavos, vigente_desde, creado_por)
       values ('iniciacion', 350000, current_date, $1)`,
      [tesorero],
    );
    await debeFallar(
      cliente,
      () => cliente.query('update tarifa_grado set monto_centavos = 1 where true'),
      /no se editan ni se borran/i,
    );
    await debeFallar(
      cliente,
      () => cliente.query('delete from tarifa_grado where true'),
      /no se editan ni se borran/i,
    );

    /* La vigente es la de fecha más reciente que ya empezó. */
    await cliente.query(
      `insert into tarifa_grado (tipo_evento, monto_centavos, vigente_desde, creado_por)
       values ('iniciacion', 400000, current_date + 30, $1)`,
      [tesorero],
    );
    const { rows } = await cliente.query(
      "select monto_centavos from v_tarifa_vigente where tipo_evento = 'iniciacion'",
    );
    assert.equal(rows[0].monto_centavos, 350000, 'la futura no debe estar vigente todavía');
  });
});
