#!/usr/bin/env node
/*
 * Cambia la contraseña de un usuario y revoca todas sus sesiones.
 *
 *   node scripts/contrasena.mjs --correo tesorero@masada324.org
 *
 * Modo no interactivo (la contraseña va en TS_CONTRASENA, nunca en un argumento):
 *
 *   TS_CONTRASENA='...' node scripts/contrasena.mjs --correo <correo> --forzar
 */
import { MINIMO_CONTRASENA, hashearContrasena, revisarFortaleza } from '../src/lib/auth.ts';
import { argumentos, conectar, preguntaOculta } from './_comun.mjs';

const { banderas, valores } = argumentos();

if (!valores.correo) {
  console.error('uso: node scripts/contrasena.mjs --correo <correo>');
  process.exit(1);
}

const correo = String(valores.correo).toLowerCase();
const cliente = await conectar();

try {
  const { rows } = await cliente.query(
    'select id, nombre, rol from usuario where correo = $1',
    [correo],
  );
  if (rows.length === 0) {
    console.error(`error: no hay usuario con el correo ${correo}.`);
    process.exit(1);
  }
  const usuario = rows[0];
  console.log(`Usuario: ${usuario.nombre} (${usuario.rol})`);

  let contrasena = process.env.TS_CONTRASENA ?? '';

  if (!contrasena || !banderas.has('forzar')) {
    console.log(`La contraseña debe tener al menos ${MINIMO_CONTRASENA} caracteres.`);
    for (;;) {
      contrasena = await preguntaOculta('  Nueva contraseña: ');
      const problema = revisarFortaleza(contrasena);
      if (problema) {
        console.log(`    ${problema}`);
        continue;
      }
      const otraVez = await preguntaOculta('  Repítela: ');
      if (contrasena !== otraVez) {
        console.log('    No coinciden, inténtalo de nuevo.');
        continue;
      }
      break;
    }
  } else {
    const problema = revisarFortaleza(contrasena);
    if (problema) {
      console.error(`error: ${problema}`);
      process.exit(1);
    }
  }

  const hash = await hashearContrasena(contrasena);
  await cliente.query('begin');
  await cliente.query('update usuario set hash_contrasena = $2 where id = $1', [
    usuario.id,
    hash,
  ]);
  const { rowCount } = await cliente.query('delete from sesion where usuario_id = $1', [
    usuario.id,
  ]);
  await cliente.query(
    `insert into bitacora (usuario_id, accion, entidad, entidad_id, detalle)
     values ($1, 'contrasena_rotada', 'usuario', $2, $3)`,
    [usuario.id, String(usuario.id), JSON.stringify({ origen: 'script' })],
  );
  await cliente.query('commit');

  console.log(
    `\nContraseña actualizada. Sesiones revocadas: ${rowCount}.`,
  );
} catch (error) {
  await cliente.query('rollback').catch(() => {});
  throw error;
} finally {
  await cliente.end().catch(() => {});
}
