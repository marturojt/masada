#!/usr/bin/env node
/*
 * Aplica las migraciones de migraciones/*.sql en orden, una vez cada una.
 *
 * Forward only, sin "down": con un solo operador, el rollback real es restaurar
 * el respaldo, no un down que nadie probó. Lo que sí hace este runner, y es el
 * 80% del valor de una herramienta de migraciones, es guardar el sha256 de cada
 * archivo aplicado y abortar si alguien edita historia.
 *
 * Uso:
 *   node scripts/migrar.mjs            aplica lo pendiente
 *   node scripts/migrar.mjs --seco     solo lista lo pendiente
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const raizApp = dirname(dirname(fileURLToPath(import.meta.url)));
const dirMigraciones = join(raizApp, 'migraciones');
const soloListar = process.argv.includes('--seco');

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(join(raizApp, '.env'));
  } catch {
    /* sin .env */
  }
}

if (!process.env.DATABASE_URL) {
  console.error('error: falta DATABASE_URL. Copia .env.example a .env y ajústalo.');
  process.exit(1);
}

const sha = (texto) => createHash('sha256').update(texto).digest('hex');

const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cliente.connect();

let bloqueado = false;
try {
  /* Evita que dos corridas compitan. */
  await cliente.query("select pg_advisory_lock(hashtext('migraciones_tesoreria'))");
  bloqueado = true;

  await cliente.query(`
    create table if not exists schema_migracion (
      version     text primary key,
      nombre      text not null,
      sha256      text not null,
      aplicada_en timestamptz not null default now()
    )
  `);

  const { rows: aplicadas } = await cliente.query(
    'select version, nombre, sha256 from schema_migracion',
  );
  const porVersion = new Map(aplicadas.map((f) => [f.version, f]));

  const archivos = (await readdir(dirMigraciones))
    .filter((n) => n.endsWith('.sql'))
    .sort();

  if (archivos.length === 0) {
    console.log('No hay migraciones en migraciones/.');
    process.exit(0);
  }

  const pendientes = [];

  for (const nombre of archivos) {
    const version = nombre.split('_')[0];
    if (!/^\d{3}$/.test(version)) {
      console.error(`error: ${nombre} no empieza con tres dígitos de versión.`);
      process.exit(1);
    }

    const contenido = await readFile(join(dirMigraciones, nombre), 'utf8');
    const hash = sha(contenido);
    const previa = porVersion.get(version);

    if (previa) {
      if (previa.sha256 !== hash) {
        console.error(
          `error: la migración ${nombre} ya fue aplicada y su contenido cambió.\n` +
            '       No edites migraciones aplicadas, crea una nueva.',
        );
        process.exit(1);
      }
      continue;
    }

    pendientes.push({ version, nombre, contenido, hash });
  }

  if (pendientes.length === 0) {
    console.log(`Base al día, ${aplicadas.length} migración(es) aplicada(s).`);
    process.exit(0);
  }

  if (soloListar) {
    console.log(`Pendientes (${pendientes.length}):`);
    for (const p of pendientes) console.log(`  ${p.nombre}`);
    process.exit(0);
  }

  for (const p of pendientes) {
    process.stdout.write(`aplicando ${p.nombre} ... `);
    try {
      await cliente.query('begin');
      await cliente.query(p.contenido);
      await cliente.query(
        'insert into schema_migracion (version, nombre, sha256) values ($1, $2, $3)',
        [p.version, p.nombre, p.hash],
      );
      await cliente.query('commit');
      console.log('listo');
    } catch (error) {
      await cliente.query('rollback');
      console.log('falló');
      console.error(`\n${error.message}`);
      if (error.position) console.error(`posición: ${error.position}`);
      if (error.hint) console.error(`pista: ${error.hint}`);
      process.exit(1);
    }
  }

  console.log(`\n${pendientes.length} migración(es) aplicada(s).`);
} finally {
  if (bloqueado) {
    await cliente
      .query("select pg_advisory_unlock(hashtext('migraciones_tesoreria'))")
      .catch(() => {});
  }
  await cliente.end().catch(() => {});
}
