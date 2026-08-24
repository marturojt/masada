#!/usr/bin/env node
/*
 * Encuentra comprobantes sueltos, en los dos sentidos:
 *
 *   - archivos en disco sin fila en la base: pasa si la transacción del
 *     movimiento falló después de escribir el archivo, que es el lado seguro del
 *     compromiso (mejor un archivo de más que una fila que apunta a la nada).
 *   - filas de archivo que ya no referencia ningún movimiento ni documento.
 *
 * Por omisión solo informa. Con --borrar sí borra, y solo lo que lleva más de un
 * día suelto, para no barrer algo que se está subiendo en este momento.
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { argumentos, conectar, raizApp } from './_comun.mjs';

const { banderas } = argumentos();
const borrar = banderas.has('borrar');
const HORAS_GRACIA = 24;

const cliente = await conectar();

try {
  const raiz = resolve(
    process.env.COMPROBANTES_DIR ?? join(raizApp, 'comprobantes'),
  );

  /* egreso_documento aparece en una migración posterior, se consulta si existe. */
  const { rows: existe } = await cliente.query(
    "select to_regclass('egreso_documento') is not null as hay",
  );
  const condicionDocumentos = existe[0].hay
    ? 'and not exists (select 1 from egreso_documento d where d.archivo_id = a.id)'
    : '';

  const { rows: sinUso } = await cliente.query(`
    select a.id, a.ruta_relativa, a.subido_en
      from archivo a
     where not exists (select 1 from movimiento m where m.archivo_id = a.id)
       ${condicionDocumentos}
       and a.subido_en < now() - interval '${HORAS_GRACIA} hours'
     order by a.subido_en
  `);

  const enBase = new Set();
  const { rows: todas } = await cliente.query('select ruta_relativa from archivo');
  for (const fila of todas) enBase.add(fila.ruta_relativa);

  const enDisco = [];
  async function recorrer(dir) {
    let entradas;
    try {
      entradas = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entrada of entradas) {
      const ruta = join(dir, entrada.name);
      if (entrada.isDirectory()) await recorrer(ruta);
      else if (entrada.name !== '.gitkeep') enDisco.push(ruta);
    }
  }
  await recorrer(raiz);

  const sinFila = [];
  for (const ruta of enDisco) {
    const rel = relative(raiz, ruta).split('\\').join('/');
    if (enBase.has(rel)) continue;
    const info = await stat(ruta);
    const horas = (Date.now() - info.mtimeMs) / 3_600_000;
    if (horas > HORAS_GRACIA) sinFila.push({ ruta, rel, horas: Math.floor(horas) });
  }

  console.log(`Almacén: ${raiz}`);
  console.log(`Archivos en disco: ${enDisco.length}, filas en la base: ${enBase.size}\n`);

  if (sinFila.length === 0) {
    console.log('Sin archivos en disco sueltos.');
  } else {
    console.log(`Archivos en disco sin fila (${sinFila.length}):`);
    for (const a of sinFila) console.log(`  ${a.rel}  (${a.horas} h)`);
  }

  if (sinUso.length === 0) {
    console.log('Sin filas de archivo sin uso.');
  } else {
    console.log(`\nFilas sin uso (${sinUso.length}):`);
    for (const f of sinUso) console.log(`  #${f.id} ${f.ruta_relativa}`);
  }

  if (!borrar) {
    if (sinFila.length > 0 || sinUso.length > 0) {
      console.log('\nNada se borró. Para borrarlos: npm run limpiar -- --borrar');
    }
    process.exit(0);
  }

  let borrados = 0;
  for (const a of sinFila) {
    await unlink(a.ruta).catch(() => {});
    borrados += 1;
  }

  await cliente.query('begin');
  for (const f of sinUso) {
    await cliente.query('delete from archivo where id = $1', [f.id]);
    const absoluta = resolve(raiz, f.ruta_relativa);
    if (absoluta.startsWith(raiz)) await unlink(absoluta).catch(() => {});
  }
  await cliente.query('commit');

  console.log(
    `\nBorrados: ${borrados} archivo(s) sin fila y ${sinUso.length} fila(s) sin uso.`,
  );
} finally {
  await cliente.end().catch(() => {});
}
