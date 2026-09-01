/*
 * Reglas de cápita. Son el corazón del sistema y las que más caro cuesta
 * equivocar, así que se prueban contra la función de la base, que es donde viven.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { crearHermano, debeFallar, enPrueba, pagarCapita, pesos } from './ayuda.mjs';

const ANIO = 2026;

test('mensual: doce meses de 500 suman 6,000', async () => {
  await enPrueba(async ({ cliente }) => {
    const id = await crearHermano(cliente, 'Prueba Mensual', '2025-12-31');
    await cliente.query('select fn_asignar_capita($1, $2, $3)', [id, ANIO, 'mensual']);

    const { rows } = await cliente.query(
      `select count(*)::int as meses, sum(monto_esperado_centavos)::int as total
         from capita_cargo where hermano_id = $1 and estado = 'vigente'`,
      [id],
    );
    assert.equal(rows[0].meses, 12);
    assert.equal(rows[0].total, 600000, `esperaba 6,000 y dio ${pesos(rows[0].total)}`);
  });
});

test('promoción: un solo cargo de 5,000, con quién la autorizó', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    const id = await crearHermano(cliente, 'Prueba Promoción', '2025-12-31');
    await cliente.query('select fn_asignar_capita($1, $2, $3, $4, $5, $6)', [
      id,
      ANIO,
      'promocion',
      8,
      vm,
      'Autorizada en tenida',
    ]);

    const { rows: cargos } = await cliente.query(
      `select count(*)::int as cargos, sum(monto_esperado_centavos)::int as total
         from capita_cargo where hermano_id = $1 and estado = 'vigente'`,
      [id],
    );
    assert.equal(cargos[0].cargos, 1);
    assert.equal(cargos[0].total, 500000);

    const { rows: plan } = await cliente.query(
      `select modalidad, autorizado_por, autorizado_en is not null as tiene_fecha
         from capita_plan where hermano_id = $1 and vigente`,
      [id],
    );
    assert.equal(plan[0].modalidad, 'promocion');
    assert.equal(Number(plan[0].autorizado_por), vm);
    assert.equal(plan[0].tiene_fecha, true);
  });
});

test('prorrateo: quien entra en abril paga 4,500 por nueve meses', async () => {
  await enPrueba(async ({ cliente }) => {
    const id = await crearHermano(cliente, 'Prueba Abril', '2026-04-15', 'aprendiz');
    await cliente.query('select fn_asignar_capita($1, $2, $3)', [id, ANIO, 'prorrateo']);

    const { rows } = await cliente.query(
      `select count(*)::int as meses, sum(monto_esperado_centavos)::int as total,
              min(to_char(periodo, 'YYYY-MM')) as primero
         from capita_cargo where hermano_id = $1 and estado = 'vigente'`,
      [id],
    );
    assert.equal(rows[0].meses, 9);
    assert.equal(rows[0].total, 450000);
    assert.equal(rows[0].primero, '2026-04');
  });
});

test('la promoción no aplica a quien entra a media marcha', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    const id = await crearHermano(cliente, 'Prueba Media Marcha', '2026-04-15');
    await debeFallar(
      cliente,
      () =>
        cliente.query('select fn_asignar_capita($1, $2, $3, $4, $5)', [
          id,
          ANIO,
          'promocion',
          5,
          vm,
        ]),
      /promoción es solo para quien está desde enero/i,
    );
  });
});

test('quien entra a media marcha tampoco puede ir en mensual', async () => {
  await enPrueba(async ({ cliente }) => {
    const id = await crearHermano(cliente, 'Prueba Mensual Tardío', '2026-06-01');
    await debeFallar(
      cliente,
      () =>
        cliente.query('select fn_asignar_capita($1, $2, $3)', [id, ANIO, 'mensual']),
      /su modalidad es prorrateo/i,
    );
  });
});

test('promoción a media marcha: 5,000 menos lo ya pagado', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    const id = await crearHermano(cliente, 'Prueba Cambio', '2025-12-31');
    await cliente.query('select fn_asignar_capita($1, $2, $3)', [id, ANIO, 'mensual']);

    /* Paga cuatro meses, 2,000. */
    const pago = await pagarCapita(cliente, id, '2026-01-15', 200000, vm);
    assert.equal(pago.aplicado, 200000);

    await cliente.query('select fn_asignar_capita($1, $2, $3, $4, $5, $6)', [
      id,
      ANIO,
      'promocion',
      8,
      vm,
      'El V∴M∴ la habilita en agosto',
    ]);

    const { rows: plan } = await cliente.query(
      'select monto_total_centavos from capita_plan where hermano_id = $1 and vigente',
      [id],
    );
    assert.equal(
      plan[0].monto_total_centavos,
      300000,
      `esperaba 3,000 y dio ${pesos(plan[0].monto_total_centavos)}`,
    );

    /* Los meses ya pagados se conservan; el resto del año se cancela. */
    const { rows: estado } = await cliente.query(
      `select esperado_centavos, pagado_centavos, adeudo_centavos
         from v_estado_cuenta_capita where hermano_id = $1`,
      [id],
    );
    assert.equal(estado[0].esperado_centavos, 500000);
    assert.equal(estado[0].pagado_centavos, 200000);
    assert.equal(estado[0].adeudo_centavos, 300000);
  });
});

test('un pago se aplica del mes más antiguo hacia adelante', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    const id = await crearHermano(cliente, 'Prueba Aplicación', '2025-12-31');
    await cliente.query('select fn_asignar_capita($1, $2, $3)', [id, ANIO, 'mensual']);

    await pagarCapita(cliente, id, '2026-01-15', 150000, vm);
    await pagarCapita(cliente, id, '2026-04-05', 70000, vm);

    const { rows } = await cliente.query(
      `select to_char(periodo, 'MM') as mes, pagado_centavos, saldo_centavos
         from v_adeudo_capita_mes where hermano_id = $1 order by periodo limit 6`,
      [id],
    );

    assert.deepEqual(
      rows.map((r) => [r.mes, r.pagado_centavos]),
      [
        ['01', 50000],
        ['02', 50000],
        ['03', 50000],
        ['04', 50000],
        ['05', 20000],
        ['06', 0],
      ],
    );
  });
});

test('no se puede aplicar a un mes más de lo que falta', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    const id = await crearHermano(cliente, 'Prueba Exceso', '2025-12-31');
    await cliente.query('select fn_asignar_capita($1, $2, $3)', [id, ANIO, 'mensual']);

    const { rows: concepto } = await cliente.query(
      "select id from concepto where clave = 'capita'",
    );
    const { rows: mov } = await cliente.query(
      `insert into movimiento
         (fecha, ejercicio_anio, periodo, tipo, bolsa, concepto_id, monto_centavos,
          descripcion, hermano_id, creado_por)
       values ('2026-01-10', 2026, '2026-01-01', 'ingreso', 'banco', $1, 900000, 'Exceso',
               $2, $3)
       returning id`,
      [concepto[0].id, id, vm],
    );
    const { rows: cargo } = await cliente.query(
      `select capita_cargo_id from v_adeudo_capita_mes
        where hermano_id = $1 order by periodo limit 1`,
      [id],
    );

    await cliente.query(
      `insert into capita_aplicacion
         (movimiento_id, capita_cargo_id, monto_aplicado_centavos, creado_por)
       values ($1, $2, 900000, $3)`,
      [mov[0].id, cargo[0].capita_cargo_id, vm],
    );

    /*
     * El trigger de aplicación es diferido: normalmente revienta al confirmar.
     * Aquí se le pide adelantarse, que es la forma estándar de probarlo sin
     * cerrar la transacción de la prueba.
     */
    await debeFallar(
      cliente,
      () =>
        cliente.query('set constraints all immediate'),
      /faltan|aplicando/i,
    );
  });
});

test('la exención cubre el mes sin mover la caja', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    const id = await crearHermano(cliente, 'Prueba Exención', '2025-12-31');
    await cliente.query('select fn_asignar_capita($1, $2, $3)', [id, ANIO, 'mensual']);

    const { rows: cargo } = await cliente.query(
      `select capita_cargo_id from v_adeudo_capita_mes
        where hermano_id = $1 order by periodo limit 1`,
      [id],
    );

    await cliente.query(
      `insert into capita_condonacion
         (capita_cargo_id, monto_centavos, motivo, autorizado_por, creado_por)
       values ($1, 50000, 'Situación económica', $2, $2)`,
      [cargo[0].capita_cargo_id, vm],
    );

    const { rows } = await cliente.query(
      `select estado_pago, condonado_centavos, saldo_centavos
         from v_adeudo_capita_mes where capita_cargo_id = $1`,
      [cargo[0].capita_cargo_id],
    );
    assert.equal(rows[0].estado_pago, 'cubierto');
    assert.equal(rows[0].condonado_centavos, 50000);
    assert.equal(rows[0].saldo_centavos, 0);

    /* Exentar no es un ingreso: la caja no se movió. */
    const { rows: caja } = await cliente.query(
      "select count(*)::int as movimientos from movimiento where hermano_id = $1",
      [id],
    );
    assert.equal(caja[0].movimientos, 0);
  });
});

test('no se puede exentar más de lo que falta del mes', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    const id = await crearHermano(cliente, 'Prueba Exención Excesiva', '2025-12-31');
    await cliente.query('select fn_asignar_capita($1, $2, $3)', [id, ANIO, 'mensual']);
    const { rows: cargo } = await cliente.query(
      `select capita_cargo_id from v_adeudo_capita_mes
        where hermano_id = $1 order by periodo limit 1`,
      [id],
    );

    await debeFallar(
      cliente,
      () =>
        cliente.query(
          `insert into capita_condonacion
             (capita_cargo_id, monto_centavos, motivo, autorizado_por, creado_por)
           values ($1, 900000, 'Demasiado', $2, $2)`,
          [cargo[0].capita_cargo_id, vm],
        ),
      /pasa de lo que falta/i,
    );
  });
});

test('la promoción acepta un monto de dispensa distinto al del ejercicio', async () => {
  await enPrueba(async ({ cliente, vm }) => {
    const hermano = await crearHermano(cliente, 'Con Dispensa De 5500', '2025-12-31');
    await cliente.query('select fn_asignar_capita($1, 2026, $2, 8, $3, $4, $5)', [
      hermano,
      'promocion',
      vm,
      'Dispensa especial',
      550000,
    ]);
    const { rows } = await cliente.query(
      'select monto_total_centavos from capita_plan where hermano_id = $1 and vigente',
      [hermano],
    );
    assert.equal(Number(rows[0].monto_total_centavos), 550000);

    /* Sin monto, sigue usando la tarifa del ejercicio. */
    const otro = await crearHermano(cliente, 'Con Dispensa Normal', '2025-12-31');
    await cliente.query('select fn_asignar_capita($1, 2026, $2, 8, $3)', [
      otro,
      'promocion',
      vm,
    ]);
    const { rows: normal } = await cliente.query(
      'select monto_total_centavos from capita_plan where hermano_id = $1 and vigente',
      [otro],
    );
    const { rows: ej } = await cliente.query(
      'select capita_promocion_centavos from ejercicio where anio = 2026',
    );
    assert.equal(Number(normal[0].monto_total_centavos), Number(ej[0].capita_promocion_centavos));
  });
});

test('el sobrante convertido en donativo deja de contar como saldo a favor y no mueve la caja', async () => {
  await enPrueba(async ({ cliente, tesorero, vm }) => {
    const hermano = await crearHermano(cliente, 'Hermano Que Pagó De Más', '2025-12-31');
    await cliente.query('select fn_asignar_capita($1, 2026, $2)', [hermano, 'mensual']);

    /* Paga 6,200: cubre el año completo (6,000) y sobran 200. */
    const pago = await pagarCapita(cliente, hermano, '2026-01-10', 620000, tesorero);
    assert.equal(pago.sinAplicar, 20000);

    const { rows: antes } = await cliente.query(
      "select coalesce(sum(efecto_centavos), 0)::int as caja from movimiento",
    );

    /* La reclasificación: dos movimientos en la misma bolsa que se anulan. */
    const { rows: conceptos } = await cliente.query(
      "select clave, id from concepto where clave in ('capita_a_donativo', 'donativo')",
    );
    const idDe = (clave) => conceptos.find((c) => c.clave === clave).id;
    await cliente.query(
      `insert into movimiento (fecha, ejercicio_anio, periodo, tipo, bolsa, concepto_id,
         monto_centavos, descripcion, hermano_id, creado_por)
       values ('2026-02-01', 2026, '2026-02-01', 'egreso', 'banco', $1, 20000,
               'Reclasificación', $2, $3),
              ('2026-02-01', 2026, '2026-02-01', 'ingreso', 'banco', $4, 20000,
               'Donativo del sobrante', $2, $3)`,
      [idDe('capita_a_donativo'), hermano, vm, idDe('donativo')],
    );

    const { rows: despues } = await cliente.query(
      "select coalesce(sum(efecto_centavos), 0)::int as caja from movimiento",
    );
    assert.equal(despues[0].caja, antes[0].caja);
  });
});

test('promoción convertida a mensual: lo pagado la salda y el resto del año va mes a mes', async () => {
  await enPrueba(async ({ cliente, tesorero, vm }) => {
    const hermano = await crearHermano(cliente, 'Hermano Del Trato Raro', '2025-12-31');

    /* Promoción de dos pagos (5,500), asignada con el monto del ejercicio. */
    const { rows: ej } = await cliente.query(
      'select capita_promocion_dos_centavos as monto from ejercicio where anio = 2026',
    );
    await cliente.query('select fn_asignar_capita($1, 2026, $2, 8, $3, $4, $5)', [
      hermano, 'promocion', vm, 'Dos pagos semestrales', ej[0].monto,
    ]);

    /* Paga el primer semestre: 2,750. */
    await pagarCapita(cliente, hermano, '2026-01-15', 275000, tesorero);

    /* Cambio de trato: el resto del año mes a mes, desde julio. */
    await cliente.query('select fn_convertir_promocion_a_mensual($1, 2026, 7, $2)', [
      hermano, 'Acordó pagar el segundo semestre mes a mes',
    ]);

    /* La promoción quedó saldada en lo pagado (el resto, condonado). */
    const { rows: promo } = await cliente.query(
      `select cc.monto_esperado_centavos, cc.periodo::text,
              (select monto_centavos from capita_condonacion where capita_cargo_id = cc.id)
                as condonado,
              (select coalesce(sum(monto_aplicado_centavos), 0)::int from capita_aplicacion
                where capita_cargo_id = cc.id) as pagado
         from capita_cargo cc
        where cc.hermano_id = $1 and cc.clase = 'promocion' and cc.estado = 'vigente'`,
      [hermano],
    );
    assert.equal(Number(promo[0].pagado), 275000);
    assert.equal(Number(promo[0].condonado), 550000 - 275000);
    /* Y su cargo se recorrió a un mes anterior al tramo mensual. */
    assert.ok(promo[0].periodo < '2026-07-01');

    /* Nacieron las seis mensualidades de julio a diciembre. */
    const { rows: meses } = await cliente.query(
      `select periodo::text, monto_esperado_centavos from capita_cargo
        where hermano_id = $1 and clase = 'mensual' and estado = 'vigente'
        order by periodo`,
      [hermano],
    );
    assert.equal(meses.length, 6);
    assert.equal(meses[0].periodo, '2026-07-01');
    assert.equal(meses[5].periodo, '2026-12-01');

    /* El total exigible del año es el del trato: 2,750 + 3,000 = 5,750. */
    const { rows: total } = await cliente.query(
      `select sum(cc.monto_esperado_centavos)::int
              - coalesce((select sum(monto_centavos) from capita_condonacion co
                           join capita_cargo c2 on c2.id = co.capita_cargo_id
                          where c2.hermano_id = $1), 0) as exigible
         from capita_cargo cc where cc.hermano_id = $1 and cc.estado = 'vigente'`,
      [hermano],
    );
    assert.equal(Number(total[0].exigible), 575000);

    /* Sus abonos de 500 se aplican a julio, agosto... */
    const pago = await pagarCapita(cliente, hermano, '2026-07-10', 50000, tesorero);
    assert.equal(pago.aplicado, 50000);
  });
});

test('la conversión no procede sin promoción vigente ni dos veces', async () => {
  await enPrueba(async ({ cliente, tesorero, vm }) => {
    const hermano = await crearHermano(cliente, 'Hermano Mensual Normal', '2025-12-31');
    await cliente.query('select fn_asignar_capita($1, 2026, $2)', [hermano, 'mensual']);
    await debeFallar(
      cliente,
      () => cliente.query('select fn_convertir_promocion_a_mensual($1, 2026, 7)', [hermano]),
      /cargo de promoción vigente/,
    );

    const otro = await crearHermano(cliente, 'Hermano Promo Sin Pagos', '2025-12-31');
    await cliente.query('select fn_asignar_capita($1, 2026, $2, 8, $3)', [otro, 'promocion', vm]);
    await pagarCapita(cliente, otro, '2026-01-15', 100000, tesorero);
    await cliente.query('select fn_convertir_promocion_a_mensual($1, 2026, 7)', [otro]);
    await debeFallar(
      cliente,
      () => cliente.query('select fn_convertir_promocion_a_mensual($1, 2026, 9)', [otro]),
      /ya tiene una exención registrada/,
    );
  });
});

test('el adeudo se separa en vencido y por vencer: nadie debe los meses que no llegan', async () => {
  await enPrueba(async ({ cliente }) => {
    const hermano = await crearHermano(cliente, 'Hermano Sin Un Pago', '2025-12-31');
    await cliente.query('select fn_asignar_capita($1, 2026, $2)', [hermano, 'mensual']);

    const { rows } = await cliente.query(
      `select esperado_centavos, vencido_centavos, por_vencer_centavos, adeudo_centavos
         from v_estado_cuenta_capita where hermano_id = $1`,
      [hermano],
    );
    const fila = rows[0];
    /* Vencido: solo los meses anteriores al mes en curso. */
    const { rows: hoy } = await cliente.query(
      "select (extract(month from current_date)::int - 1) as vencidos",
    );
    assert.equal(Number(fila.vencido_centavos), hoy[0].vencidos * 50000);
    /* Y el total del año sigue cuadrando: vencido + por vencer = esperado. */
    assert.equal(
      Number(fila.vencido_centavos) + Number(fila.por_vencer_centavos),
      Number(fila.adeudo_centavos),
    );
    assert.equal(Number(fila.adeudo_centavos), 600000);
  });
});

test('el estado torcido de una reasignación vieja se repara con la conversión', async () => {
  await enPrueba(async ({ cliente, tesorero, vm }) => {
    /* Reproduce a Miller: promoción de dos pagos, pagó 2,750, y una
       reasignación a mensual hecha ANTES de la guarda dejó 11,000 esperados.
       El estado se fabrica a mano porque la guarda nueva ya no deja crearlo. */
    const hermano = await crearHermano(cliente, 'Miller De Prueba', '2025-12-31');
    const { rows: ej } = await cliente.query(
      'select capita_promocion_dos_centavos as m from ejercicio where anio = 2026',
    );
    await cliente.query('select fn_asignar_capita($1, 2026, $2, 8, $3, $4, $5)', [
      hermano, 'promocion', vm, 'Dos pagos', ej[0].m,
    ]);
    await pagarCapita(cliente, hermano, '2026-01-15', 275000, tesorero);

    /* La reasignación equivocada, como quedó en producción. */
    await cliente.query('update capita_plan set vigente = false where hermano_id = $1', [
      hermano,
    ]);
    const { rows: plan } = await cliente.query(
      `insert into capita_plan (hermano_id, ejercicio_anio, modalidad, mes_desde, mes_hasta,
         monto_mensual_centavos, monto_total_centavos, creado_por, actualizado_por)
       select $1, 2026, 'mensual', 1, 12, 50000, 600000, $2, $2 returning id`,
      [hermano, vm],
    );
    for (let mes = 1; mes <= 12; mes++) {
      if (mes === 8) continue; /* agosto lo ocupa la promoción */
      await cliente.query(
        `insert into capita_cargo (plan_id, hermano_id, ejercicio_anio, periodo,
           monto_esperado_centavos, clase, creado_por)
         values ($1, $2, 2026, make_date(2026, $3, 1), 50000, 'mensual', $4)`,
        [plan[0].id, hermano, mes, vm],
      );
    }
    const { rows: torcido } = await cliente.query(
      `select sum(monto_esperado_centavos)::int as esperado from capita_cargo
        where hermano_id = $1 and estado = 'vigente'`,
      [hermano],
    );
    assert.equal(Number(torcido[0].esperado), 1100000);

    /* La guarda nueva impide volver a tropezar con la misma piedra. */
    await debeFallar(
      cliente,
      () => cliente.query('select fn_asignar_capita($1, 2026, $2)', [hermano, 'mensual']),
      /usa "Convertir la promoción a mensual"/,
    );

    /* Y la conversión repara: 2,750 saldados + julio a diciembre mensual. */
    await cliente.query('select fn_convertir_promocion_a_mensual($1, 2026, 7, $2)', [
      hermano, 'Reparación del caso real',
    ]);

    const { rows: final_ } = await cliente.query(
      `select sum(monto_esperado_centavos)::int
              - coalesce((select sum(co.monto_centavos) from capita_condonacion co
                           join capita_cargo c2 on c2.id = co.capita_cargo_id
                          where c2.hermano_id = $1), 0) as exigible,
              count(*) filter (where clase = 'mensual')::int as mensuales,
              min(periodo) filter (where clase = 'mensual')::text as primer_mensual
         from capita_cargo where hermano_id = $1 and estado = 'vigente'`,
      [hermano],
    );
    assert.equal(Number(final_[0].exigible), 575000);
    assert.equal(Number(final_[0].mensuales), 6);
    assert.equal(final_[0].primer_mensual, '2026-07-01');

    /* Sus siguientes 500 caen en julio. */
    const pago = await pagarCapita(cliente, hermano, '2026-09-01', 50000, tesorero);
    assert.equal(pago.aplicado, 50000);
  });
});
