/*
 * Alta de tarifas de grado. Nunca retroactivas: la vigencia empieza hoy o
 * después, y lo capturado antes conserva el monto con el que se capturó.
 */
import { registrarEn } from '../bitacora';
import { consumirNonce } from '../csrf';
import { enTransaccion } from '../db';
import { insertarTarifa, NOMBRE_TARIFA, type TipoEventoTarifa } from '../datos/tarifas';
import { formatoMXN } from '../dinero';
import { ErrorDeNegocio } from '../errores';
import { hoyISO } from '../fechas';
import type { Sesion } from '../sesion';

interface Contexto {
  sesion: Sesion;
  nonce: string;
  idPeticion: string;
}

export async function capturarTarifa(
  ctx: Contexto,
  datos: {
    tipo_evento: TipoEventoTarifa;
    monto: number;
    vigente_desde: string;
    notas?: string | undefined;
  },
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  if (datos.vigente_desde < hoyISO()) {
    throw new ErrorDeNegocio(
      'Las tarifas no aplican en retroactivo: la vigencia empieza hoy o una fecha futura.',
      'vigente_desde',
    );
  }

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'tarifa_nueva');

    const id = await insertarTarifa(
      tx,
      {
        tipoEvento: datos.tipo_evento,
        montoCentavos: datos.monto,
        vigenteDesde: datos.vigente_desde,
        notas: datos.notas,
      },
      usuarioId,
    );

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'tarifa_capturada',
      entidad: 'tarifa_grado',
      entidadId: id,
      detalle: {
        tipo: NOMBRE_TARIFA[datos.tipo_evento],
        monto: formatoMXN(datos.monto),
        vigente_desde: datos.vigente_desde,
      },
    });
  }, usuarioId);
}
