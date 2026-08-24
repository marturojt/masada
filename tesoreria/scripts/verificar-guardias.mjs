#!/usr/bin/env node
/*
 * Falla si una página o endpoint no exige sesión.
 *
 * La autorización de este panel es explícita en cada archivo de src/pages,
 * nunca en el middleware, porque comparar rutas en middleware es la clase de
 * comprobación que los bypass de URL encoding saben burlar. El precio de esa
 * decisión es que se puede olvidar el guard en un archivo nuevo, y este script
 * es el que lo cobra.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const raizApp = dirname(dirname(fileURLToPath(import.meta.url)));
const paginas = join(raizApp, 'src', 'pages');

/* Rutas que a propósito no exigen sesión. */
const SIN_GUARDIA = new Set(['entrar.astro', 'salir.ts', '404.astro', '500.astro']);

const GUARDIAS = ['requerirSesion', 'requerirVM'];

async function* recorrer(dir) {
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) yield* recorrer(ruta);
    else if (/\.(astro|ts)$/.test(entrada.name)) yield ruta;
  }
}

const problemas = [];
let revisados = 0;

for await (const ruta of recorrer(paginas)) {
  const rel = relative(paginas, ruta);
  if (SIN_GUARDIA.has(rel)) continue;
  revisados += 1;

  const contenido = await readFile(ruta, 'utf8');

  if (!GUARDIAS.some((g) => contenido.includes(g))) {
    problemas.push(`${rel}: no invoca requerirSesion ni requerirVM`);
  }

  /* Un <form method="post"> a mano se salta el CSRF y el nonce del componente. */
  if (/<form[^>]*method=["']post["']/i.test(contenido)) {
    problemas.push(
      `${rel}: usa <form method="post"> directo. Usa el componente Formulario, ` +
        'que inyecta el token CSRF y el nonce',
    );
  }
}

if (problemas.length > 0) {
  console.error('Guardias faltantes:\n');
  for (const p of problemas) console.error(`  - ${p}`);
  console.error(`\n${problemas.length} problema(s) en ${revisados} archivo(s).`);
  process.exit(1);
}

console.log(`Guardias correctas en ${revisados} archivo(s) de src/pages.`);
