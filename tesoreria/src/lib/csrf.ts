/*
 * Dos protecciones distintas que suelen confundirse:
 *
 * - Token CSRF: uno por sesión, contesta "esta petición viene de mi formulario".
 * - Nonce: uno por formulario emitido, de un solo uso, contesta "este envío no
 *   es un reenvío del mismo formulario". Es lo que evita cobrar dos veces una
 *   cápita por un doble clic o por un F5 con reenvío.
 *
 * El nonce se verifica al validar y se consume dentro de la transacción que
 * escribe el movimiento, nunca antes: si la validación falla, el usuario debe
 * poder corregir y reenviar el mismo formulario.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { consulta, unaFila, type Tx } from './db';
import { FormularioYaEnviado } from './errores';

const VIDA_NONCE_MS = 2 * 60 * 60 * 1000;

export const CAMPO_CSRF = '_csrf';
export const CAMPO_NONCE = '_nonce';

/** Comparación en tiempo constante de dos tokens en base64url. */
export function tokensIguales(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Emite un nonce para un formulario concreto. Se llama al renderizar el GET. */
export async function emitirNonce(
  sesionHash: string,
  proposito: string,
): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await consulta(
    `insert into nonce_formulario (token, sesion_hash, proposito, expira_en)
     values ($1, $2, $3, $4)`,
    [token, sesionHash, proposito, new Date(Date.now() + VIDA_NONCE_MS)],
  );
  return token;
}

/**
 * Emite varios nonces del mismo propósito en una sola consulta. Sirve para las
 * listas donde cada fila tiene su propio botón: si compartieran nonce, solo
 * funcionaría el primer clic de la página.
 */
export async function emitirNonces(
  sesionHash: string,
  proposito: string,
  cuantos: number,
): Promise<string[]> {
  if (cuantos <= 0) return [];
  const tokens = Array.from({ length: cuantos }, () =>
    randomBytes(24).toString('base64url'),
  );
  await consulta(
    `insert into nonce_formulario (token, sesion_hash, proposito, expira_en)
     select t, $2, $3, $4 from unnest($1::text[]) as t`,
    [tokens, sesionHash, proposito, new Date(Date.now() + VIDA_NONCE_MS)],
  );
  return tokens;
}

/** ¿El nonce existe, es de esta sesión, es de este formulario y no expiró? */
export async function nonceVigente(
  token: string,
  sesionHash: string,
  proposito: string,
): Promise<boolean> {
  const fila = await unaFila<{ token: string }>(
    `select token from nonce_formulario
      where token = $1 and sesion_hash = $2 and proposito = $3 and expira_en > now()`,
    [token, sesionHash, proposito],
  );
  return fila !== null;
}

/**
 * Consume el nonce de forma atómica. Va DENTRO de la transacción que escribe el
 * movimiento, así el segundo envío no puede colarse entre la comprobación y la
 * escritura.
 */
export async function consumirNonce(
  tx: Tx,
  token: string,
  sesionHash: string,
  proposito: string,
): Promise<void> {
  const fila = await tx.unaFila<{ token: string }>(
    `delete from nonce_formulario
      where token = $1 and sesion_hash = $2 and proposito = $3 and expira_en > now()
      returning token`,
    [token, sesionHash, proposito],
  );
  if (!fila) throw new FormularioYaEnviado();
}
