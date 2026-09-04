/*
 * Cierre de un pendiente de evidencia como "sin evidencia formal": el registro
 * no se toca, solo queda constancia de que la evidencia se buscó y no existe.
 * Es reversible en espíritu: si el documento aparece después, se adjunta donde
 * la entidad lo permita, y la dispensa queda como historia de la búsqueda.
 */
import { registrarEn } from '../bitacora';
import { consumirNonce } from '../csrf';
import { enTransaccion, unaFila } from '../db';
import { ErrorDeNegocio } from '../errores';
import type { Sesion } from '../sesion';

interface Contexto {
  sesion: Sesion;
  nonce: string;
  idPeticion: string;
}

const ENTIDADES: Record<string, { tabla: string; nombre: string }> = {
  movimiento: { tabla: 'movimiento', nombre: 'el ingreso' },
  traspaso: { tabla: 'traspaso', nombre: 'el traspaso' },
  aportacion: { tabla: 'aportacion', nombre: 'la aportación' },
  gt_obligacion: { tabla: 'gt_obligacion', nombre: 'la obligación GT' },
  gt_membresia: { tabla: 'gt_membresia', nombre: 'la membresía' },
};

export async function cerrarSinEvidencia(
  ctx: Contexto,
  entidad: string,
  entidadId: number,
  motivo: string,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  const definicion = ENTIDADES[entidad];
  if (!definicion) throw new ErrorDeNegocio('Ese tipo de pendiente no existe.');

  /* El nombre de la tabla sale de la lista cerrada de arriba, no del usuario. */
  const existe = await unaFila<{ id: number }>(
    `select id from ${definicion.tabla} where id = $1`,
    [entidadId],
  );
  if (!existe) throw new ErrorDeNegocio(`Ya no existe ${definicion.nombre}.`);

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'evidencia_cerrar');
    try {
      await tx.consulta(
        `insert into evidencia_dispensa (entidad, entidad_id, motivo, creado_por)
         values ($1, $2, $3, $4)`,
        [entidad, entidadId, motivo, usuarioId],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ErrorDeNegocio('Ese pendiente ya estaba cerrado como sin evidencia formal.');
      }
      throw error;
    }
    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'evidencia_dispensada',
      entidad,
      entidadId,
      detalle: { motivo },
    });
  }, usuarioId);
}
