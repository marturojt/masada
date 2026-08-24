/*
 * Reglas de egresos: dos firmas, suplencia del V∴M∴ y el ciclo de comprobación.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { crearHermano, debeFallar, enPrueba } from './ayuda.mjs';

async function nuevoEgreso(cliente, usuarioId, opciones = {}) {
  const { rows: concepto } = await cliente.query(
    'select id from concepto where clave = $1',
    [opciones.concepto ?? 'agape'],
  );
  const { rows: folio } = await cliente.query('select fn_siguiente_folio(2026) as folio');
  const { rows } = await cliente.query(
    `insert into egreso
       (folio, fecha_solicitud, ejercicio_anio, concepto_id, beneficiario, descripcion,
        monto_solicitado_centavos, requiere_comprobacion, creado_por, actualizado_por)
     values ($1, '2026-08-05', 2026, $2, 'Proveedor', 'Prueba', $3, $4, $5, $5)
     returning id, folio`,
    [
      folio[0].folio,
      concepto[0].id,
      opciones.monto ?? 300000,
      opciones.porComprobar ?? true,
      usuarioId,
    ],
  );
  return rows[0];
}

const firmar = (cliente, egresoId, rolRequerido, usuarioId, rolFirmante, motivo = null) =>
  cliente.query(
    `insert into egreso_firma
       (egreso_id, rol_requerido, firmado_por, rol_firmante, es_suplencia, motivo_suplencia)
     values ($1, $2, $3, $4, $5, $6)`,
    [egresoId, rolRequerido, usuarioId, rolFirmante, rolRequerido !== rolFirmante, motivo],
  );

test('sin las dos firmas no se puede autorizar', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const egreso = await nuevoEgreso(cliente, tesorero);
    await firmar(cliente, egreso.id, 'tesorero', tesorero, 'tesorero');

    await debeFallar(
      cliente,
      () =>
        cliente.query("update egreso set estado = 'autorizado' where id = $1", [egreso.id]),
      /Faltan firmas/i,
    );
  });
});

test('con las dos firmas el egreso queda autorizado', async () => {
  await enPrueba(async ({ cliente, tesorero, vm }) => {
    const egreso = await nuevoEgreso(cliente, tesorero);
    await firmar(cliente, egreso.id, 'tesorero', tesorero, 'tesorero');
    await firmar(cliente, egreso.id, 'venerable_maestro', vm, 'venerable_maestro');

    await cliente.query("update egreso set estado = 'autorizado' where id = $1", [egreso.id]);
    const { rows } = await cliente.query(
      'select estado, monto_autorizado_centavos from egreso where id = $1',
      [egreso.id],
    );
    assert.equal(rows[0].estado, 'autorizado');
    assert.equal(rows[0].monto_autorizado_centavos, 300000);
  });
});

test('el V∴M∴ puede suplir al tesorero, dejando el motivo', async () => {
  await enPrueba(async ({ cliente, tesorero, vm }) => {
    const egreso = await nuevoEgreso(cliente, tesorero);
    await firmar(cliente, egreso.id, 'venerable_maestro', vm, 'venerable_maestro');
    await firmar(
      cliente,
      egreso.id,
      'tesorero',
      vm,
      'venerable_maestro',
      'El tesorero no asistió a la tenida',
    );

    const { rows } = await cliente.query(
      `select rol_requerido, es_suplencia, motivo_suplencia
         from egreso_firma where egreso_id = $1 order by rol_requerido`,
      [egreso.id],
    );
    assert.equal(rows[0].rol_requerido, 'tesorero');
    assert.equal(rows[0].es_suplencia, true);
    assert.match(rows[0].motivo_suplencia, /no asistió/);
  });
});

test('el tesorero no puede suplir al V∴M∴', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const egreso = await nuevoEgreso(cliente, tesorero);
    await debeFallar(
      cliente,
      () =>
        firmar(
          cliente,
          egreso.id,
          'venerable_maestro',
          tesorero,
          'tesorero',
          'Intento indebido',
        ),
      /solo_vm_suple|check constraint/i,
    );
  });
});

test('una suplencia sin motivo no se registra', async () => {
  await enPrueba(async ({ cliente, tesorero, vm }) => {
    const egreso = await nuevoEgreso(cliente, tesorero);
    await debeFallar(
      cliente,
      () =>
        firmar(cliente, egreso.id, 'tesorero', vm, 'venerable_maestro', null),
      /firma_suplencia_coherente|check constraint/i,
    );
  });
});

test('el monto comprobado se calcula solo, desde los recibos', async () => {
  await enPrueba(async ({ cliente, tesorero, vm }) => {
    const egreso = await nuevoEgreso(cliente, tesorero);
    await firmar(cliente, egreso.id, 'tesorero', tesorero, 'tesorero');
    await firmar(cliente, egreso.id, 'venerable_maestro', vm, 'venerable_maestro');
    await cliente.query("update egreso set estado = 'autorizado' where id = $1", [egreso.id]);
    await cliente.query(
      `update egreso set estado = 'por_comprobar', monto_entregado_centavos = 300000,
              fecha_entrega = '2026-08-06' where id = $1`,
      [egreso.id],
    );

    await cliente.query(
      `insert into egreso_documento (egreso_id, tipo, fecha, monto_centavos, creado_por)
       values ($1, 'recibo', '2026-08-07', 180000, $2)`,
      [egreso.id, tesorero],
    );

    const { rows } = await cliente.query(
      'select monto_comprobado_centavos from egreso where id = $1',
      [egreso.id],
    );
    assert.equal(rows[0].monto_comprobado_centavos, 180000);
  });
});

test('no se cierra la comprobación si no cuadra', async () => {
  await enPrueba(async ({ cliente, tesorero, vm }) => {
    const egreso = await nuevoEgreso(cliente, tesorero);
    await firmar(cliente, egreso.id, 'tesorero', tesorero, 'tesorero');
    await firmar(cliente, egreso.id, 'venerable_maestro', vm, 'venerable_maestro');
    await cliente.query("update egreso set estado = 'autorizado' where id = $1", [egreso.id]);
    await cliente.query(
      `update egreso set estado = 'por_comprobar', monto_entregado_centavos = 300000,
              fecha_entrega = '2026-08-06' where id = $1`,
      [egreso.id],
    );
    await cliente.query(
      `insert into egreso_documento (egreso_id, tipo, fecha, monto_centavos, creado_por)
       values ($1, 'recibo', '2026-08-07', 180000, $2)`,
      [egreso.id, tesorero],
    );

    await debeFallar(
      cliente,
      () =>
        cliente.query("update egreso set estado = 'comprobado' where id = $1", [egreso.id]),
      /egreso_comprobado_cuadra|check constraint/i,
    );

    /* Con la devolución del sobrante sí cierra. */
    await cliente.query(
      'update egreso set monto_devuelto_centavos = 120000 where id = $1',
      [egreso.id],
    );
    await cliente.query(
      "update egreso set estado = 'comprobado', fecha_comprobacion = '2026-08-10' where id = $1",
      [egreso.id],
    );
    const { rows } = await cliente.query('select estado from egreso where id = $1', [
      egreso.id,
    ]);
    assert.equal(rows[0].estado, 'comprobado');
  });
});

test('no se puede saltar de registrado a pagado sin autorizar', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const egreso = await nuevoEgreso(cliente, tesorero, { porComprobar: false });
    await debeFallar(
      cliente,
      () =>
        cliente.query(
          `update egreso set estado = 'pagado', monto_entregado_centavos = 300000,
                  fecha_entrega = '2026-08-06' where id = $1`,
          [egreso.id],
        ),
      /No se puede pasar de/i,
    );
  });
});

test('el folio es consecutivo por ejercicio', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const uno = await nuevoEgreso(cliente, tesorero);
    const dos = await nuevoEgreso(cliente, tesorero);
    assert.match(uno.folio, /^EG-2026-\d{4}$/);
    const siguiente = Number(dos.folio.slice(-4)) - Number(uno.folio.slice(-4));
    assert.equal(siguiente, 1, `${uno.folio} y ${dos.folio} no son consecutivos`);
  });
});

test('un egreso de grado exige indicar el hermano', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const hermano = await crearHermano(cliente, 'Prueba Grado', '2025-12-31');
    const { rows: concepto } = await cliente.query(
      "select id, requiere_hermano from concepto where clave = 'gl_iniciacion'",
    );
    assert.equal(concepto[0].requiere_hermano, true);

    /* La regla la impone el trigger del libro de caja al mover el dinero. */
    await debeFallar(
      cliente,
      () =>
        cliente.query(
          `insert into movimiento
             (fecha, ejercicio_anio, periodo, tipo, concepto_id, monto_centavos, descripcion,
              creado_por)
           values ('2026-08-06', 2026, '2026-08-01', 'egreso', $1, 100000, 'Sin hermano', $2)`,
          [concepto[0].id, tesorero],
        ),
      /exige indicar de qué hermano/i,
    );

    await cliente.query(
      `insert into movimiento
         (fecha, ejercicio_anio, periodo, tipo, bolsa, concepto_id, monto_centavos,
          descripcion, hermano_id, creado_por)
       values ('2026-08-06', 2026, '2026-08-01', 'egreso', 'banco', $1, 100000,
               'Con hermano', $2, $3)`,
      [concepto[0].id, hermano, tesorero],
    );
  });
});
