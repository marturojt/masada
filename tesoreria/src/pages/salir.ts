/*
 * Cierre de sesión. Solo por POST: un <a href="/salir"> se dispara con cualquier
 * prefetch o con una imagen incrustada, y el usuario se encuentra fuera sin
 * haberlo pedido.
 */
import type { APIContext } from 'astro';
import { registrar } from '@lib/bitacora';
import { ipDelCliente } from '@lib/red';
import { revocarSesion } from '@lib/sesion';

export async function POST(ctx: APIContext): Promise<Response> {
  const sesion = ctx.locals.sesion;

  if (sesion) {
    await registrar({
      usuarioId: sesion.usuario.id,
      idPeticion: ctx.locals.idPeticion,
      accion: 'salida',
      entidad: 'usuario',
      entidadId: sesion.usuario.id,
      ip: ipDelCliente(ctx.request, ctx.clientAddress),
    });
  }

  await revocarSesion(ctx);
  return ctx.redirect('/entrar', 303);
}

/** Un GET no cierra sesión, solo manda a la pantalla de acceso. */
export const GET = (ctx: APIContext): Response => ctx.redirect('/entrar', 303);
