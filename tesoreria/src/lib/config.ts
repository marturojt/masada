/*
 * Único módulo que toca process.env. Valida al arrancar y falla ruidosamente:
 * un panel de tesorería a medio configurar es peor que un panel que no arranca.
 *
 * Regla dura: nada de import.meta.env para secretos. En un build SSR eso puede
 * quedar horneado en dist/, lo que rompe la rotación y filtra el secreto con
 * cualquier lectura de archivo. Todo se lee en tiempo de ejecución.
 */
import { join } from 'node:path';
import { z } from 'zod';

if (!process.env.DATABASE_URL) {
  try {
    /* Node 20.12+. Evita la dependencia de dotenv. */
    process.loadEnvFile(join(process.cwd(), '.env'));
  } catch {
    /* Sin .env: se usan las variables del entorno, como en systemd. */
  }
}

const booleano = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const esquema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  COMPROBANTES_DIR: z.string().min(1, 'COMPROBANTES_DIR es obligatoria'),
  TS_ORIGEN: z
    .url({ error: 'TS_ORIGEN debe ser una URL, por ejemplo http://127.0.0.1:4322' })
    .refine((v) => !v.endsWith('/'), 'TS_ORIGEN no debe terminar en diagonal'),
  TS_ENTORNO: z.enum(['local', 'produccion']).default('local'),
  TS_COOKIE_NOMBRE: z.string().min(1).default('ts_sesion'),
  TS_MAX_SUBIDA_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  TS_CONFIAR_PROXY: booleano,
  TS_RUTA_SITIO_PUBLICO: z.string().optional(),
});

const resultado = esquema.safeParse(process.env);

if (!resultado.success) {
  const detalles = resultado.error.issues
    .map((i) => `  - ${i.path.join('.') || '(raíz)'}: ${i.message}`)
    .join('\n');
  throw new Error(
    `Configuración inválida. Revisa el archivo .env (hay una plantilla en .env.example):\n${detalles}`,
  );
}

export const config = Object.freeze(resultado.data);

export const esProduccion = config.TS_ENTORNO === 'produccion';

/** Zona horaria de todas las fechas de operación. */
export const ZONA = 'America/Mexico_City';
