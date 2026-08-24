/*
 * Utilidades compartidas por los scripts de operación: conexión, preguntas por
 * consola y lectura de contraseñas sin eco.
 */
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const raizApp = dirname(dirname(fileURLToPath(import.meta.url)));

export function cargarEntorno() {
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(join(raizApp, '.env'));
    } catch {
      /* sin .env, se usan las variables del entorno */
    }
  }
  if (!process.env.DATABASE_URL) {
    console.error('error: falta DATABASE_URL. Copia .env.example a .env y ajústalo.');
    process.exit(1);
  }
}

export async function conectar() {
  cargarEntorno();
  const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await cliente.connect();
  return cliente;
}

/** Lee los argumentos con forma --clave valor y --bandera. */
export function argumentos(argv = process.argv.slice(2)) {
  const banderas = new Set();
  const valores = {};
  for (let i = 0; i < argv.length; i += 1) {
    const actual = argv[i];
    if (!actual.startsWith('--')) continue;
    const clave = actual.slice(2);
    const siguiente = argv[i + 1];
    if (siguiente && !siguiente.startsWith('--')) {
      valores[clave] = siguiente;
      i += 1;
    } else {
      banderas.add(clave);
    }
  }
  return { banderas, valores };
}

export function pregunta(texto) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolver) => {
    rl.question(texto, (respuesta) => {
      rl.close();
      resolver(respuesta.trim());
    });
  });
}

/** Pregunta sin mostrar lo que se escribe. */
export function preguntaOculta(texto) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolver) => {
    let silenciado = false;
    /* readline escribe cada tecla, aquí se corta salvo el propio texto. */
    rl._writeToOutput = (cadena) => {
      if (!silenciado) rl.output.write(cadena);
    };
    rl.question(texto, (respuesta) => {
      rl.output.write('\n');
      rl.close();
      resolver(respuesta);
    });
    silenciado = true;
  });
}

export async function confirmar(texto) {
  const r = (await pregunta(`${texto} [s/N] `)).toLowerCase();
  return r === 's' || r === 'si' || r === 'sí';
}
