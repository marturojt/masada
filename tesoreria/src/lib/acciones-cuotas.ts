/*
 * Las acciones de cuotas de grado viven en dos fichas: la del hermano y la del
 * candidato. Esto las atiende igual en las dos, para que la regla sea una.
 */
import { cancelarCuota, registrarCuota } from './casos/cuotas';
import { ErrorDeNegocio } from './errores';
import { esquemaCancelarCuota, esquemaCuotaGrado } from './esquemas/hermano';
import { validar, type Entrada } from './formulario';
import type { Sesion } from './sesion';

export const ACCIONES_CUOTA = ['cuota', 'cuota_cancelar'] as const;

export type ResultadoAccionCuota =
  | { ok: true }
  | { ok: false; errores: Record<string, string>; estado: number };

export async function atenderAccionCuota(
  entrada: Entrada,
  sesion: Sesion,
  hermanoId: number,
  idPeticion: string,
): Promise<ResultadoAccionCuota> {
  try {
    if (entrada.accion === 'cuota') {
      const r = await validar(entrada, { esquema: esquemaCuotaGrado, proposito: 'cuota_grado', sesion });
      if (!r.ok) return { ok: false, errores: r.errores, estado: r.estado };
      await registrarCuota({ sesion, nonce: r.nonce, idPeticion }, hermanoId, r.datos);
      return { ok: true };
    }
    const r = await validar(entrada, {
      esquema: esquemaCancelarCuota,
      proposito: 'cuota_grado_cancelar',
      sesion,
    });
    if (!r.ok) return { ok: false, errores: r.errores, estado: r.estado };
    await cancelarCuota({ sesion, nonce: r.nonce, idPeticion }, hermanoId, r.datos.cuota_id, r.datos.motivo);
    return { ok: true };
  } catch (error) {
    if (!(error instanceof ErrorDeNegocio)) throw error;
    return { ok: false, errores: { [error.campo ?? '_general']: error.message }, estado: 422 };
  }
}
