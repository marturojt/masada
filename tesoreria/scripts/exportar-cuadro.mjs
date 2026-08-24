#!/usr/bin/env node
/*
 * Exporta el padrón al cuadro logial del sitio público.
 *
 *   node scripts/exportar-cuadro.mjs                 muestra el diff, no escribe
 *   node scripts/exportar-cuadro.mjs --escribir      escribe los archivos
 *   node scripts/exportar-cuadro.mjs --anio 2026
 *
 * Por omisión solo enseña qué cambiaría: ese archivo termina publicado en
 * internet, así que escribirlo es una decisión explícita.
 *
 * Doble lista blanca: la vista v_cuadro_json ya solo proyecta nombre, grado y
 * cargo, y aquí se copian únicamente las claves esperadas. Si la vista devolviera
 * una clave de más, este script aborta en lugar de publicarla.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { argumentos, conectar, raizApp } from './_comun.mjs';

const { banderas, valores } = argumentos();
const escribir = banderas.has('escribir');

/* Orden y lista blanca de claves del cuadro, igual que en el sitio. */
const CLAVES_CUADRO = [
  'anio',
  'anioVulgar',
  'venerableMaestro',
  'primerVigilante',
  'segundoVigilante',
  'orador',
  'secretario',
  'tesorero',
  'oficiales',
  'maestros',
  'companeros',
  'aprendices',
];

/** Reordena y filtra. Aborta si aparece una clave que no está en la lista. */
export function ordenarCuadro(documento) {
  const sobrantes = Object.keys(documento).filter((k) => !CLAVES_CUADRO.includes(k));
  if (sobrantes.length > 0) {
    throw new Error(
      `La proyección trae claves que no se publican: ${sobrantes.join(', ')}. ` +
        'Revisa la vista v_cuadro_json antes de exportar.',
    );
  }

  const salida = {};
  for (const clave of CLAVES_CUADRO) {
    if (documento[clave] !== undefined) salida[clave] = documento[clave];
  }
  return salida;
}

/*
 * El JSON se escribe con el mismo estilo que el archivo del sitio: dignatarios y
 * oficiales compactos en una línea, y los arreglos de nombres en una sola línea.
 * No es capricho: si se usara JSON.stringify a secas, cada exportación produciría
 * un diff enorme donde no se distingue lo que de verdad cambió.
 */
const cadena = (valor) => JSON.stringify(valor);

function formatearCuadro(doc) {
  const lineas = ['{'];
  const par = (clave, valor) => `  ${cadena(clave)}: ${valor}`;
  const cuerpo = [];

  cuerpo.push(par('anio', String(doc.anio)));
  cuerpo.push(par('anioVulgar', cadena(doc.anioVulgar)));

  for (const clave of [
    'venerableMaestro',
    'primerVigilante',
    'segundoVigilante',
    'orador',
    'secretario',
    'tesorero',
  ]) {
    const dignatario = doc[clave];
    if (!dignatario) continue;
    const campos = Object.entries(dignatario)
      .map(([k, v]) => `${cadena(k)}: ${cadena(v)}`)
      .join(', ');
    cuerpo.push(par(clave, `{ ${campos} }`));
  }

  const oficiales = doc.oficiales ?? [];
  if (oficiales.length === 0) {
    cuerpo.push(par('oficiales', '[]'));
  } else {
    const filas = oficiales.map((o) => {
      const campos = Object.entries(o)
        .map(([k, v]) => `${cadena(k)}: ${cadena(v)}`)
        .join(', ');
      return `    { ${campos} }`;
    });
    cuerpo.push(`  ${cadena('oficiales')}: [\n${filas.join(',\n')}\n  ]`);
  }

  for (const clave of ['maestros', 'companeros', 'aprendices']) {
    const nombres = doc[clave] ?? [];
    cuerpo.push(
      par(clave, nombres.length === 0 ? '[]' : `[${nombres.map(cadena).join(', ')}]`),
    );
  }

  lineas.push(cuerpo.join(',\n'));
  lineas.push('}');
  return `${lineas.join('\n')}\n`;
}

function formatearPastMasters(doc) {
  const items = doc.items ?? [];
  if (items.length === 0) return '{\n  "items": []\n}\n';
  const filas = items.map(
    (i) => `    { ${cadena('anio')}: ${i.anio}, ${cadena('nombre')}: ${cadena(i.nombre)} }`,
  );
  return `{\n  ${cadena('items')}: [\n${filas.join(',\n')}\n  ]\n}\n`;
}

/** Diff simple por líneas, suficiente para revisar antes de publicar. */
function diff(antes, despues) {
  const a = antes.split('\n');
  const b = despues.split('\n');
  const lineas = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) lineas.push(`  - ${a[i]}`);
    if (b[i] !== undefined) lineas.push(`  + ${b[i]}`);
  }
  return lineas;
}

async function comparar(ruta, contenido, etiqueta) {
  let previo = null;
  try {
    previo = await readFile(ruta, 'utf8');
  } catch {
    /* todavía no existe */
  }

  if (previo === contenido) {
    console.log(`= ${etiqueta}: sin cambios`);
    return false;
  }

  if (previo === null) {
    console.log(`+ ${etiqueta}: archivo nuevo (${contenido.split('\n').length} líneas)`);
  } else {
    console.log(`~ ${etiqueta}: cambia`);
    for (const linea of diff(previo, contenido)) console.log(linea);
  }
  return true;
}

/*
 * El cuerpo va en una función y no al ras del módulo porque las pruebas importan
 * ordenarCuadro de aquí: importarlo no debe conectarse a la base ni escribir nada.
 */
async function principal() {
  const cliente = await conectar();

  try {
    const raizSitio = process.env.TS_RUTA_SITIO_PUBLICO ?? join(raizApp, '..');

    const anio = Number(
      valores.anio ??
        (await cliente.query('select max(anio) as anio from ejercicio')).rows[0].anio,
    );

    const { rows: cuadro } = await cliente.query(
      'select documento from v_cuadro_json where anio = $1',
      [anio],
    );
    if (cuadro.length === 0) {
      console.error(`error: no hay ejercicio ${anio} en la base.`);
      process.exit(1);
    }

    const documento = ordenarCuadro(cuadro[0].documento);
    const jsonCuadro = formatearCuadro(documento);

    const { rows: past } = await cliente.query('select documento from v_pastmasters_json');
    const jsonPast = formatearPastMasters(past[0].documento);

    const rutaCuadro = join(raizSitio, 'src', 'content', 'cuadro', `${anio}.json`);
    const rutaPast = join(raizSitio, 'src', 'content', 'pastmasters', 'historico.json');

    console.log(`Sitio público: ${raizSitio}\n`);

    const cambiaCuadro = await comparar(rutaCuadro, jsonCuadro, `cuadro/${anio}.json`);
    const cambiaPast = await comparar(rutaPast, jsonPast, 'pastmasters/historico.json');

    if (!cambiaCuadro && !cambiaPast) {
      console.log('\nEl sitio ya está al día.');
      process.exit(0);
    }

    if (!escribir) {
      console.log(
        '\nNada se escribió. Para aplicarlo: npm run exportar:cuadro -- --escribir\n' +
          'Después, en la raíz del sitio: npm run build',
      );
      process.exit(0);
    }

    if (cambiaCuadro) await writeFile(rutaCuadro, jsonCuadro, 'utf8');
    if (cambiaPast) await writeFile(rutaPast, jsonPast, 'utf8');

    console.log(
      '\nArchivos escritos. Ahora, en la raíz del sitio:\n' +
        '  npm run build      valida el esquema y regenera el sitio\n' +
        '  git diff           revisa el cambio antes de publicarlo',
    );
  } finally {
    await cliente.end().catch(() => {});
  }
}

if (import.meta.main) await principal();
