/*
 * Sesiones en base de datos.
 *
 * En la tabla se guarda solo el sha256 del identificador, nunca el
 * identificador: un volcado de la base no alcanza para secuestrar una sesión
 * viva. La cookie lleva el identificador en claro, que es la única copia.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { config, esProduccion } from './config';
import { consulta, unaFila } from './db';
import { SesionRequerida } from './errores';
import type { Rol, UsuarioSesion } from './tipos';

/** Expiración por inactividad. */
const INACTIVIDAD_MS = 8 * 60 * 60 * 1000;
/** Tope absoluto desde la creación, ni con uso continuo se pasa de aquí. */
const LIMITE_MS = 7 * 24 * 60 * 60 * 1000;

export interface Sesion {
  idHash: string;
  csrfToken: string;
  usuario: UsuarioSesion;
}

/** Contexto mínimo que necesitan estas funciones, sirve para páginas y endpoints. */
export interface ContextoSesion {
  cookies: AstroCookies;
  locals: App.Locals;
}

export const hashSesion = (id: string): string =>
  createHash('sha256').update(id).digest('hex');

function opcionesCookie(expira: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: esProduccion,
    path: '/',
    expires: expira,
  };
}

/** Crea la sesión, la guarda y deja la cookie puesta. */
export async function crearSesion(
  ctx: ContextoSesion,
  usuarioId: number,
  ip: string | null,
  userAgent: string | null,
): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const ahora = Date.now();
  const expira = new Date(ahora + INACTIVIDAD_MS);
  const limite = new Date(ahora + LIMITE_MS);

  await consulta(
    `insert into sesion (id_hash, usuario_id, csrf_token, expira_en, limite_en, ip, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [hashSesion(id), usuarioId, csrfToken, expira, limite, ip, userAgent?.slice(0, 300) ?? null],
  );

  ctx.cookies.set(config.TS_COOKIE_NOMBRE, id, opcionesCookie(limite));
  return id;
}

interface FilaSesion {
  id_hash: string;
  csrf_token: string;
  expira_en: Date;
  limite_en: Date;
  usuario_id: number;
  correo: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
}

/**
 * Resuelve la sesión de la cookie. Devuelve null si no hay, si expiró, si el
 * usuario se desactivó o si la fila ya no existe (revocación inmediata).
 * Renueva de forma deslizante cuando queda menos de la mitad del tiempo.
 */
export async function leerSesion(ctx: ContextoSesion): Promise<Sesion | null> {
  const id = ctx.cookies.get(config.TS_COOKIE_NOMBRE)?.value;
  if (!id) return null;

  const idHash = hashSesion(id);
  const fila = await unaFila<FilaSesion>(
    `select s.id_hash, s.csrf_token, s.expira_en, s.limite_en,
            u.id as usuario_id, u.correo, u.nombre, u.rol, u.activo
       from sesion s
       join usuario u on u.id = s.usuario_id
      where s.id_hash = $1`,
    [idHash],
  );

  if (!fila || !fila.activo) {
    ctx.cookies.delete(config.TS_COOKIE_NOMBRE, { path: '/' });
    return null;
  }

  const ahora = Date.now();
  const expira = new Date(fila.expira_en).getTime();
  const limite = new Date(fila.limite_en).getTime();

  if (ahora >= expira || ahora >= limite) {
    await consulta('delete from sesion where id_hash = $1', [idHash]);
    ctx.cookies.delete(config.TS_COOKIE_NOMBRE, { path: '/' });
    return null;
  }

  /* Renovación deslizante, sin escribir en cada petición. */
  if (expira - ahora < INACTIVIDAD_MS / 2) {
    const nuevaExpira = new Date(Math.min(ahora + INACTIVIDAD_MS, limite));
    await consulta(
      'update sesion set expira_en = $2, ultimo_uso = now() where id_hash = $1',
      [idHash, nuevaExpira],
    );
    ctx.cookies.set(config.TS_COOKIE_NOMBRE, id, opcionesCookie(new Date(limite)));
  }

  return {
    idHash: fila.id_hash,
    csrfToken: fila.csrf_token,
    usuario: {
      id: fila.usuario_id,
      correo: fila.correo,
      nombre: fila.nombre,
      rol: fila.rol,
    },
  };
}

/** Revoca la fila, no solo borra la cookie. */
export async function revocarSesion(ctx: ContextoSesion): Promise<void> {
  const id = ctx.cookies.get(config.TS_COOKIE_NOMBRE)?.value;
  if (id) {
    await consulta('delete from sesion where id_hash = $1', [hashSesion(id)]);
  }
  ctx.cookies.delete(config.TS_COOKIE_NOMBRE, { path: '/' });
}

/** Revoca todas las sesiones de un usuario, por ejemplo al rotar su contraseña. */
export async function revocarSesionesDe(usuarioId: number): Promise<void> {
  await consulta('delete from sesion where usuario_id = $1', [usuarioId]);
}

/** Borra sesiones y nonces vencidos. Se llama de forma oportunista al entrar. */
export async function limpiarVencidos(): Promise<void> {
  await consulta('delete from sesion where expira_en < now() or limite_en < now()');
  await consulta('delete from nonce_formulario where expira_en < now()');
}

/**
 * Guard de página. El middleware ya redirigió a quien no tiene sesión, así que
 * aquí solo se convierte locals.sesion en un valor no nulo y tipado. Si truena,
 * es que el middleware y esta página no coinciden en qué rutas son públicas, y
 * eso debe verse fuerte en lugar de servir la página sin sesión.
 */
export function requerirSesion(ctx: { locals: App.Locals }): Sesion {
  const sesion = ctx.locals.sesion;
  if (!sesion) throw new SesionRequerida();
  return sesion;
}

export const esVM = (sesion: Sesion): boolean =>
  sesion.usuario.rol === 'venerable_maestro';

/**
 * Guard de página para lo que solo puede hacer el Venerable Maestro. Devuelve la
 * sesión, o una respuesta 403 que la página debe devolver tal cual:
 *
 *   const g = requerirVM(Astro);
 *   if (g instanceof Response) return g;
 */
export function requerirVM(ctx: { locals: App.Locals }): Sesion | Response {
  const sesion = requerirSesion(ctx);
  if (esVM(sesion)) return sesion;
  return respuesta403(
    'Esta operación la autoriza únicamente el Venerable Maestro.',
  );
}

export function respuesta403(mensaje: string): Response {
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8">` +
      `<title>Sin permiso</title></head><body>` +
      `<h1>Sin permiso</h1><p>${mensaje}</p><p><a href="/">Volver al tablero</a></p>` +
      `</body></html>`,
    {
      status: 403,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    },
  );
}
