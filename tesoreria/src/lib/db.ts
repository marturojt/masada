/*
 * Acceso a PostgreSQL. El Pool no sale de este módulo: todo pasa por
 * consulta / unaFila / laFila / enTransaccion, siempre con parámetros.
 */
import pg from 'pg';
import { config } from './config';
import { ErrorDeNegocio } from './errores';

const { Pool, types } = pg;

/*
 * Parsers antes de crear el pool.
 * DATE como texto 'AAAA-MM-DD': convertirlo a Date desplaza el día según la
 * zona del proceso y termina moviendo un movimiento al mes anterior.
 * NUMERIC como texto: nunca se mezcla con Number, el dinero va en centavos.
 */
types.setTypeParser(1082, (v) => v); // date
types.setTypeParser(1114, (v) => v); // timestamp sin zona
types.setTypeParser(1700, (v) => v); // numeric
types.setTypeParser(20, (v) => Number(v)); // int8, los ids caben de sobra

declare global {
  // eslint-disable-next-line no-var
  var __poolTesoreria: pg.Pool | undefined;
}

/* El ??= evita fugar un pool por recarga del servidor de desarrollo. */
export const pool: pg.Pool = (globalThis.__poolTesoreria ??= new Pool({
  connectionString: config.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'tesoreria',
  options: '-c statement_timeout=10000',
}));

export type Parametros = readonly unknown[];

export async function consulta<T extends object = Record<string, unknown>>(
  sql: string,
  params: Parametros = [],
): Promise<T[]> {
  const r = await pool.query<T>(sql, params as unknown[]);
  return r.rows;
}

/** Devuelve la primera fila o null. */
export async function unaFila<T extends object = Record<string, unknown>>(
  sql: string,
  params: Parametros = [],
): Promise<T | null> {
  const filas = await consulta<T>(sql, params);
  return filas[0] ?? null;
}

/** Devuelve la primera fila o lanza. Para invariantes que deben cumplirse. */
export async function laFila<T extends object = Record<string, unknown>>(
  sql: string,
  params: Parametros = [],
): Promise<T> {
  const fila = await unaFila<T>(sql, params);
  if (fila === null) {
    throw new Error('La consulta no devolvió filas y se esperaba exactamente una');
  }
  return fila;
}

/** Handle de transacción. Tiene la misma API, atada a un cliente. */
export interface Tx {
  consulta<T extends object = Record<string, unknown>>(
    sql: string,
    params?: Parametros,
  ): Promise<T[]>;
  unaFila<T extends object = Record<string, unknown>>(
    sql: string,
    params?: Parametros,
  ): Promise<T | null>;
  laFila<T extends object = Record<string, unknown>>(
    sql: string,
    params?: Parametros,
  ): Promise<T>;
}

/**
 * Abre una transacción y la cierra siempre.
 * Si se pasa usuarioId, queda disponible en la sesión de Postgres como
 * app.usuario_id, que es lo que leen los triggers de auditoría.
 */
export async function enTransaccion<T>(
  fn: (tx: Tx) => Promise<T>,
  usuarioId?: number | null,
): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('begin');
    if (usuarioId != null) {
      await cliente.query('select set_config($1, $2, true)', [
        'app.usuario_id',
        String(usuarioId),
      ]);
    }

    const tx: Tx = {
      async consulta(sql, params = []) {
        const r = await cliente.query(sql, params as unknown[]);
        return r.rows as never;
      },
      async unaFila(sql, params = []) {
        const r = await cliente.query(sql, params as unknown[]);
        return (r.rows[0] ?? null) as never;
      },
      async laFila(sql, params = []) {
        const r = await cliente.query(sql, params as unknown[]);
        if (r.rows.length === 0) {
          throw new Error('La consulta no devolvió filas y se esperaba exactamente una');
        }
        return r.rows[0] as never;
      },
    };

    const resultado = await fn(tx);
    /*
     * El commit puede fallar: los triggers diferidos, como el que valida la
     * aplicación de un pago de cápita, se evalúan justo aquí.
     */
    await cliente.query('commit');
    return resultado;
  } catch (error) {
    try {
      await cliente.query('rollback');
    } catch {
      /* la conexión ya estaba perdida */
    }
    throw comoErrorDeNegocioSiAplica(error);
  } finally {
    cliente.release();
  }
}

/**
 * P0001 es el código de raise exception de plpgsql: siempre viene de una regla
 * de negocio nuestra, y sus mensajes ya están escritos en español para el
 * tesorero. Convertirlo aquí evita que un mes cerrado o una aplicación excedida
 * terminen como un error 500 sin explicación.
 */
function comoErrorDeNegocioSiAplica(error: unknown): unknown {
  if (error instanceof ErrorDeNegocio) return error;
  const e = error as { code?: string; message?: string };
  if (e?.code === 'P0001' && e.message) return new ErrorDeNegocio(e.message);
  return error;
}
