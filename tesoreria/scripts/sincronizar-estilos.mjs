#!/usr/bin/env node
/*
 * Copia tokens.css y global.css del sitio público a src/styles/heredado/.
 *
 * Se copia en vez de importar por ruta relativa o enlazar con symlink para que
 * tesoreria/ pueda construirse sola, sin el resto del repo presente. Los
 * archivos copiados SÍ se versionan, son insumo del build.
 *
 * Uso:
 *   node scripts/sincronizar-estilos.mjs              copia y reporta
 *   node scripts/sincronizar-estilos.mjs --verificar  no copia, falla si divergen
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raizApp = dirname(dirname(fileURLToPath(import.meta.url)));
const raizSitio = process.env.TS_RUTA_SITIO_PUBLICO ?? dirname(raizApp);
const origen = join(raizSitio, 'src', 'styles');
const destino = join(raizApp, 'src', 'styles', 'heredado');

const ARCHIVOS = ['tokens.css', 'global.css'];
const AVISO = [
  '/*',
  ' * ARCHIVO GENERADO. No editar aquí.',
  ' * Copia de src/styles/<archivo> del sitio público.',
  ' * Para actualizarlo: npm run estilos',
  ' */',
  '',
].join('\n');

const soloVerificar = process.argv.includes('--verificar');
const sha = (texto) => createHash('sha256').update(texto).digest('hex');

let divergencias = 0;
let copiados = 0;

await mkdir(destino, { recursive: true });

for (const archivo of ARCHIVOS) {
  const rutaOrigen = join(origen, archivo);
  const rutaDestino = join(destino, archivo);

  let contenidoOrigen;
  try {
    contenidoOrigen = await readFile(rutaOrigen, 'utf8');
  } catch {
    if (soloVerificar) {
      console.warn(`aviso: no se encontró ${rutaOrigen}, no se puede verificar`);
      continue;
    }
    console.error(`error: no se encontró ${rutaOrigen}`);
    process.exit(1);
  }

  const esperado = AVISO + contenidoOrigen;
  let actual = null;
  try {
    actual = await readFile(rutaDestino, 'utf8');
  } catch {
    /* todavía no existe */
  }

  if (actual !== null && sha(actual) === sha(esperado)) {
    if (!soloVerificar) console.log(`= ${archivo} sin cambios`);
    continue;
  }

  if (soloVerificar) {
    divergencias += 1;
    console.error(
      `divergencia: ${archivo} cambió en el sitio público. Corre: npm run estilos`,
    );
    continue;
  }

  await writeFile(rutaDestino, esperado, 'utf8');
  copiados += 1;
  console.log(`${actual === null ? '+' : '~'} ${archivo} actualizado`);
}

if (soloVerificar && divergencias > 0) {
  process.exit(1);
}
if (!soloVerificar) {
  console.log(
    copiados === 0 ? 'Estilos heredados al día.' : `Estilos sincronizados (${copiados}).`,
  );
}
