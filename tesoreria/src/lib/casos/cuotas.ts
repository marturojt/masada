/*
 * Casos de uso de las cuotas de grado por cobrar.
 *
 * Registrar una cuota es decir "esta persona debe tanto por su iniciación (o
 * afiliación, aumento, exaltación)". Pasa cuando la logia paga el trámite a la
 * Gran Tesorería antes de que el candidato o el hermano cubra su parte. Los
 * pagos no se aplican aquí: la base los aplica sola al capturar el ingreso de
 * la cuota (migración 028).
 */
import { registrarEn } from '../bitacora';
import { consumirNonce } from '../csrf';
import { enTransaccion, unaFila } from '../db';
import { insertarCuota, NOMBRE_EVENTO_CUOTA, type EventoCuota } from '../datos/cuotas';
import { formatoMXN } from '../dinero';
import { ErrorDeNegocio } from '../errores';
import { hoyISO } from '../fechas';
import type { Sesion } from '../sesion';
import { esNivelVM } from '../tipos';

interface Contexto {
  sesion: Sesion;
  nonce: string;
  idPeticion: string;
}

export async function registrarCuota(
  ctx: Contexto,
  hermanoId: number,
  datos: { tipo_evento: EventoCuota; monto: number; fecha: string; notas?: string | undefined },
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  if (datos.fecha > hoyISO()) {
    throw new ErrorDeNegocio('La fecha de la cuota no puede ser futura.', 'fecha');
  }

  const persona = await unaFila<{ nombre_completo: string; estatus: string }>(
    'select nombre_completo, estatus from hermano where id = $1',
    [hermanoId],
  );
  if (!persona) throw new ErrorDeNegocio('Esa persona no está en el padrón.');
  if (persona.estatus === 'desistio') {
    throw new ErrorDeNegocio('Ese candidato desistió: no se le registran cuotas nuevas.');
  }

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'cuota_grado');
    const id = await insertarCuota(
      tx,
      {
        hermanoId,
        tipoEvento: datos.tipo_evento,
        montoCentavos: datos.monto,
        fecha: datos.fecha,
        notas: datos.notas,
      },
      usuarioId,
    );
    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'cuota_grado_registrada',
      entidad: 'cuota_grado_cargo',
      entidadId: id,
      detalle: {
        hermano: persona.nombre_completo,
        cuota: NOMBRE_EVENTO_CUOTA[datos.tipo_evento],
        monto: formatoMXN(datos.monto),
      },
    });
  }, usuarioId);
}

/** Cancela una cuota capturada por error. Solo nivel V∴M∴ y solo sin pagos. */
export async function cancelarCuota(
  ctx: Contexto,
  hermanoId: number,
  cuotaId: number,
  motivo: string,
): Promise<void> {
  if (!esNivelVM(ctx.sesion.usuario.rol)) {
    throw new ErrorDeNegocio('Cancelar una cuota lo autoriza el Venerable Maestro.');
  }
  const usuarioId = ctx.sesion.usuario.id;

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'cuota_grado_cancelar');
    let fila: { tipo_evento: EventoCuota; monto_centavos: number } | null;
    try {
      fila = await tx.unaFila<{ tipo_evento: EventoCuota; monto_centavos: number }>(
        `update cuota_grado_cargo
            set estatus = 'cancelado', motivo_cancelacion = $3,
                cancelado_por = $4, cancelado_en = now()
          where id = $1 and hermano_id = $2 and estatus = 'vigente'
          returning tipo_evento, monto_centavos`,
        [cuotaId, hermanoId, motivo, usuarioId],
      );
    } catch (error) {
      const e = error as { code?: string; message?: string };
      if (e.code === 'P0001') throw new ErrorDeNegocio(e.message ?? 'No se pudo cancelar.');
      throw error;
    }
    if (!fila) throw new ErrorDeNegocio('Esa cuota no existe o ya estaba cancelada.');
    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'cuota_grado_cancelada',
      entidad: 'cuota_grado_cargo',
      entidadId: cuotaId,
      detalle: {
        cuota: NOMBRE_EVENTO_CUOTA[fila.tipo_evento],
        monto: formatoMXN(fila.monto_centavos),
        motivo,
      },
    });
  }, usuarioId);
}
