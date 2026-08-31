/*
 * El rol super_admin: mismo nivel que el Venerable Maestro. Firma en el lugar
 * del V∴M∴ sin ser suplencia, suple al tesorero con motivo, y las reglas de
 * siempre (el tesorero no sube de nivel) se conservan.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { debeFallar, enPrueba } from './ayuda.mjs';

async function superAdmin(cliente) {
  const { rows } = await cliente.query(
    `insert into usuario (correo, nombre, hash_contrasena, rol)
     values ('prueba-sa@ejemplo.mx', 'Super Admin de prueba', 'scrypt$1$1$1$x$y', 'super_admin')
     returning id`,
  );
  return Number(rows[0].id);
}

async function nuevoEgreso(cliente, usuarioId) {
  const { rows: concepto } = await cliente.query(
    "select id from concepto where clave = 'agape'",
  );
  const { rows: folio } = await cliente.query('select fn_siguiente_folio(2026) as folio');
  const { rows } = await cliente.query(
    `insert into egreso
       (folio, fecha_solicitud, ejercicio_anio, concepto_id, beneficiario, descripcion,
        monto_solicitado_centavos, requiere_comprobacion, creado_por, actualizado_por)
     values ($1, '2026-08-05', 2026, $2, 'Proveedor', 'Prueba', 100000, false, $3, $3)
     returning id`,
    [folio[0].folio, concepto[0].id, usuarioId],
  );
  return rows[0].id;
}

test('el super_admin firma en el lugar del V∴M∴ sin ser suplencia', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const sa = await superAdmin(cliente);
    const egreso = await nuevoEgreso(cliente, tesorero);

    await cliente.query(
      `insert into egreso_firma
         (egreso_id, rol_requerido, firmado_por, rol_firmante, es_suplencia)
       values ($1, 'venerable_maestro', $2, 'super_admin', false)`,
      [egreso, sa],
    );

    const { rows } = await cliente.query(
      'select es_suplencia from egreso_firma where egreso_id = $1',
      [egreso],
    );
    assert.equal(rows[0].es_suplencia, false);
  });
});

test('el super_admin suple al tesorero solo con motivo', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const sa = await superAdmin(cliente);
    const egreso = await nuevoEgreso(cliente, tesorero);

    await debeFallar(
      cliente,
      () =>
        cliente.query(
          `insert into egreso_firma
             (egreso_id, rol_requerido, firmado_por, rol_firmante, es_suplencia)
           values ($1, 'tesorero', $2, 'super_admin', true)`,
          [egreso, sa],
        ),
      /firma_suplencia_coherente/,
    );

    await cliente.query(
      `insert into egreso_firma
         (egreso_id, rol_requerido, firmado_por, rol_firmante, es_suplencia, motivo_suplencia)
       values ($1, 'tesorero', $2, 'super_admin', true, 'El tesorero está de viaje')`,
      [egreso, sa],
    );
  });
});

test('el tesorero sigue sin poder firmar en el lugar del V∴M∴', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const egreso = await nuevoEgreso(cliente, tesorero);
    await debeFallar(
      cliente,
      () =>
        cliente.query(
          `insert into egreso_firma
             (egreso_id, rol_requerido, firmado_por, rol_firmante, es_suplencia, motivo_suplencia)
           values ($1, 'venerable_maestro', $2, 'tesorero', true, 'Intento indebido')`,
          [egreso, tesorero],
        ),
      /firma_suplencia_coherente/,
    );
  });
});

test('las dos firmas pueden ser del mismo nivel: super_admin por ambos lados no, por el V∴M∴ sí', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const sa = await superAdmin(cliente);
    const egreso = await nuevoEgreso(cliente, tesorero);

    /* Cubre al tesorero con motivo y firma su propio lado: ambas válidas. */
    await cliente.query(
      `insert into egreso_firma
         (egreso_id, rol_requerido, firmado_por, rol_firmante, es_suplencia, motivo_suplencia)
       values ($1, 'tesorero', $2, 'super_admin', true, 'Suplencia registrada')`,
      [egreso, sa],
    );
    await cliente.query(
      `insert into egreso_firma
         (egreso_id, rol_requerido, firmado_por, rol_firmante, es_suplencia)
       values ($1, 'venerable_maestro', $2, 'super_admin', false)`,
      [egreso, sa],
    );
    await cliente.query("update egreso set estado = 'autorizado' where id = $1", [egreso]);
    const { rows } = await cliente.query('select estado from egreso where id = $1', [egreso]);
    assert.equal(rows[0].estado, 'autorizado');
  });
});

test('un rol desconocido no entra a usuario', async () => {
  await enPrueba(async ({ cliente }) => {
    await debeFallar(
      cliente,
      () =>
        cliente.query(
          `insert into usuario (correo, nombre, hash_contrasena, rol)
           values ('x@x.mx', 'X', 'scrypt$1$1$1$x$y', 'administrador')`,
        ),
      /usuario_rol_check/,
    );
  });
});
