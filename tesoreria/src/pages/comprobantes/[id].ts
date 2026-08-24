/*
 * Sirve un comprobante solo a quien tiene sesión.
 *
 * Los archivos viven fuera del webroot y nunca los sirve Apache: la única puerta
 * es este endpoint. Cada acceso queda en la bitácora, que en un libro de
 * tesorería es información que vale.
 */
import type { APIContext } from 'astro';
import { obtenerArchivo, respuestaArchivo } from '@lib/archivos';
import { registrar } from '@lib/bitacora';
import { ipDelCliente } from '@lib/red';
import { requerirSesion } from '@lib/sesion';

export async function GET(ctx: APIContext): Promise<Response> {
  const sesion = requerirSesion(ctx);

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response('No encontrado', { status: 404 });
  }

  const fila = await obtenerArchivo(id);
  if (!fila) return new Response('No encontrado', { status: 404 });

  await registrar({
    usuarioId: sesion.usuario.id,
    idPeticion: ctx.locals.idPeticion,
    accion: 'comprobante_visto',
    entidad: 'archivo',
    entidadId: id,
    ip: ipDelCliente(ctx.request, ctx.clientAddress),
  });

  return respuestaArchivo(fila);
}
