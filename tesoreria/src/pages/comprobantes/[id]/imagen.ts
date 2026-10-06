/*
 * La imagen visible de un comprobante, para el visor de la interfaz: el
 * original si el navegador lo pinta, o el JPEG derivado si es HEIC. Misma
 * puerta que el original: solo con sesión, y cada acceso queda en bitácora.
 */
import type { APIContext } from 'astro';
import { obtenerArchivo } from '@lib/archivos';
import { registrar } from '@lib/bitacora';
import { respuestaImagenVisor } from '@lib/imagenes';
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

  const respuesta = await respuestaImagenVisor(fila);
  if (!respuesta) {
    /* No es imagen: que lo atienda el enlace normal del comprobante. */
    return new Response(null, { status: 303, headers: { location: `/comprobantes/${id}` } });
  }

  await registrar({
    usuarioId: sesion.usuario.id,
    idPeticion: ctx.locals.idPeticion,
    accion: 'comprobante_visto',
    entidad: 'archivo',
    entidadId: id,
    ip: ipDelCliente(ctx.request, ctx.clientAddress),
  });

  return respuesta;
}
