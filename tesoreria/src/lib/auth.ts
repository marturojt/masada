/*
 * Contraseñas con scrypt de la biblioteca estándar.
 *
 * Por qué no argon2 ni bcrypt: los dos son addons nativos. Instalar una cadena
 * de compilación en el VPS para tenerlos es peor seguridad neta que usar un KDF
 * memory hard que ya viene en Node. El trade-off honesto es que argon2id resiste
 * mejor el crackeo con GPU, y se compensa con passphrase larga obligatoria,
 * límite de intentos, y el prefijo versionado del hash, que permite migrar
 * después sin tocar la tabla.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derivar = promisify(scrypt) as (
  contrasena: string | Buffer,
  sal: Buffer,
  largo: number,
  opciones: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 32_768; // 2^15
const R = 8;
const P = 1;
const LARGO = 64;
/* 128 * N * r son 32 MiB, que roza el maxmem por defecto de Node. Explícito. */
const MAXMEM = 64 * 1024 * 1024;

export const MINIMO_CONTRASENA = 14;

/* Lista corta de lo que nunca debe pasar por contraseña de tesorería. */
const OBVIAS = [
  'contrasena',
  'contraseña',
  'password',
  'masada',
  'masada324',
  'tesoreria',
  'tesorería',
  '12345678',
  'qwertyuiop',
];

/** Devuelve null si la contraseña sirve, o el motivo del rechazo. */
export function revisarFortaleza(contrasena: string): string | null {
  const limpia = contrasena.normalize('NFKC');
  if (limpia.length < MINIMO_CONTRASENA) {
    return `Usa al menos ${MINIMO_CONTRASENA} caracteres. Una frase con espacios sirve y es fácil de recordar.`;
  }
  const minuscula = limpia.toLowerCase();
  if (OBVIAS.some((o) => minuscula.includes(o))) {
    return 'Esa contraseña es demasiado predecible para el sistema de tesorería.';
  }
  if (new Set(limpia).size < 6) {
    return 'Usa más variedad de caracteres.';
  }
  return null;
}

export async function hashearContrasena(contrasena: string): Promise<string> {
  const sal = randomBytes(16);
  const derivada = await derivar(contrasena.normalize('NFKC'), sal, LARGO, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return [
    'scrypt',
    N,
    R,
    P,
    sal.toString('base64'),
    derivada.toString('base64'),
  ].join('$');
}

export async function verificarContrasena(
  contrasena: string,
  hash: string,
): Promise<boolean> {
  const partes = hash.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;

  const n = Number(partes[1]);
  const r = Number(partes[2]);
  const p = Number(partes[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  /* Techo defensivo: un hash manipulado no debe poder pedir memoria sin límite. */
  if (n > 1 << 20 || r > 32 || p > 16) return false;

  let sal: Buffer;
  let esperada: Buffer;
  try {
    sal = Buffer.from(partes[4]!, 'base64');
    esperada = Buffer.from(partes[5]!, 'base64');
  } catch {
    return false;
  }
  if (sal.length === 0 || esperada.length === 0) return false;

  const derivada = await derivar(contrasena.normalize('NFKC'), sal, esperada.length, {
    N: n,
    r,
    p,
    maxmem: MAXMEM,
  });

  return derivada.length === esperada.length && timingSafeEqual(derivada, esperada);
}
