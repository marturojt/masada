/*
 * Registro de ingresos que no son cápita: cuotas de grado que paga el candidato,
 * donativos y aportaciones extraordinarias.
 *
 * Las cápitas tienen su propio caso de uso, porque además de mover caja hay que
 * aplicarlas a los meses que cubren.
 */
import { guardarComprobante } from '../archivos';
import { registrarEn } from '../bitacora';
import { consumirNonce } from '../csrf';
import { enTransaccion } from '../db';
import { obtenerConcepto } from '../datos/conceptos';
import { insertarMovimiento } from '../datos/movimientos';
import { ErrorDeNegocio } from '../errores';
import { formatoMXN } from '../dinero';
import type { DatosIngreso } from '../esquemas/movimiento';
import type { Sesion } from '../sesion';
import { unaFila } from '../db';

export interface ContextoCaso {
  sesion: Sesion;
  nonce: string;
  idPeticion: string;
}

export async function registrarIngreso(
  ctx: ContextoCaso,
  datos: DatosIngreso,
  comprobante: File | undefined,
): Promise<number> {
  const usuarioId = ctx.sesion.usuario.id;

  const concepto = await obtenerConcepto(datos.concepto_id);
  if (!concepto || !concepto.activo) {
    throw new ErrorDeNegocio('El concepto elegido no existe o está desactivado.', 'concepto_id');
  }
  if (concepto.naturaleza !== 'ingreso') {
    throw new ErrorDeNegocio('Ese concepto es de egreso, no de ingreso.', 'concepto_id');
  }
  if (!concepto.seleccionable) {
    throw new ErrorDeNegocio(
      'Ese concepto lo maneja el sistema por su cuenta. Las cápitas se registran en su propio módulo.',
      'concepto_id',
    );
  }
  if (concepto.requiere_hermano && datos.hermano_id === null) {
    throw new ErrorDeNegocio(
      `Para "${concepto.nombre}" hay que indicar de qué hermano se trata.`,
      'hermano_id',
    );
  }

  let nombreHermano: string | null = null;
  if (datos.hermano_id !== null) {
    const fila = await unaFila<{ nombre_completo: string }>(
      'select nombre_completo from hermano where id = $1',
      [datos.hermano_id],
    );
    if (!fila) throw new ErrorDeNegocio('Ese hermano no está en el padrón.', 'hermano_id');
    nombreHermano = fila.nombre_completo;
  }

  /*
   * El archivo se guarda antes de abrir la transacción: copiar megabytes con una
   * transacción abierta es pedir problemas de bloqueo.
   */
  let archivoId: number | null = null;
  if (comprobante) {
    const guardado = await guardarComprobante(comprobante, usuarioId, datos.fecha);
    archivoId = guardado.id;
  }

  const descripcion =
    datos.descripcion ??
    (nombreHermano ? `${concepto.nombre} de ${nombreHermano}` : concepto.nombre);

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'ingreso_nuevo');

    const id = await insertarMovimiento(
      tx,
      {
        fecha: datos.fecha,
        tipo: 'ingreso',
        bolsa: datos.bolsa,
        conceptoId: concepto.id,
        montoCentavos: datos.monto,
        descripcion,
        hermanoId: datos.hermano_id,
        archivoId,
      },
      usuarioId,
    );

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'ingreso_registrado',
      entidad: 'movimiento',
      entidadId: id,
      detalle: {
        concepto: concepto.clave,
        monto: formatoMXN(datos.monto),
        fecha: datos.fecha,
        hermano: nombreHermano,
        con_comprobante: archivoId !== null,
      },
    });

    return id;
  }, usuarioId);
}
