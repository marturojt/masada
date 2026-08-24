#!/usr/bin/env node
/*
 * Prepara la base de pruebas: la crea si falta y le aplica las migraciones.
 *
 * Es una base aparte, con sufijo _pruebas, para que ninguna prueba pueda tocar
 * los datos de trabajo.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import pg from 'pg';
import { cargarEntorno, raizApp } from './_comun.mjs';

cargarEntorno();

const urlTrabajo = process.env.DATABASE_URL;
const urlPruebas =
  process.env.TS_BD_PRUEBAS ?? urlTrabajo.replace(/\/([^/?]+)(\?|$)/, '/$1_pruebas$2');

if (urlPruebas === urlTrabajo) {
  console.error(
    'error: la base de pruebas no puede ser la misma que la de trabajo.\n' +
      'Define TS_BD_PRUEBAS con otra base.',
  );
  process.exit(1);
}

const nombre = decodeURIComponent(new URL(urlPruebas).pathname.slice(1));
const urlAdmin = new URL(urlPruebas);
urlAdmin.pathname = '/postgres';

const admin = new pg.Client({ connectionString: urlAdmin.toString() });
await admin.connect();

try {
  const { rows } = await admin.query('select 1 from pg_database where datname = $1', [
    nombre,
  ]);
  if (rows.length === 0) {
    /* El nombre viene de la propia configuración, no de una entrada externa. */
    await admin.query(`create database ${JSON.stringify(nombre).replace(/"/g, '"')}`);
    console.log(`+ base de pruebas creada: ${nombre}`);
  }
} finally {
  await admin.end().catch(() => {});
}

const resultado = spawnSync(
  process.execPath,
  [join(raizApp, 'scripts', 'migrar.mjs')],
  {
    env: { ...process.env, DATABASE_URL: urlPruebas },
    stdio: 'inherit',
  },
);

process.exit(resultado.status ?? 1);
