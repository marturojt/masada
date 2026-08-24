/*
 * Traspaso entre bolsas: el depósito del efectivo al banco, o un retiro.
 *
 * No pasa por firmas porque el dinero no sale de la logia, solo cambia de lugar.
 * Lo que sí exige es descripción, y conserva la ficha cuando la hay. Un traspaso
 * equivocado se corrige con el inverso: el libro no borra.
 */
import { guardarComprobante } from '../archivos';
import { registrarEn } from '../bitacora';
import { consumirNonce } from '../csrf';
import { enTransaccion } from '../db';
import { insertarTraspaso } from '../datos/traspasos';
import { saldoDeCaja } from '../datos/movimientos';
import { formatoMXN } from '../dinero';
import { ErrorDeNegocio } from '../errores';
import type { Sesion } from '../sesion';
import type { Bolsa } from '../tipos';

interface Contexto {
  sesion: Sesion;
  nonce: string;
  idPeticion: string;
}

export async function registrarTraspaso(
  ctx: Contexto,
  datos: {
    fecha: string;
    direccion: 'deposito' | 'retiro';
    monto: number;
    descripcion: string;
  },
  ficha: File | undefined,
): Promise<number> {
  const usuarioId = ctx.sesion.usuario.id;

  const deBolsa: Bolsa = datos.direccion === 'deposito' ? 'efectivo' : 'banco';
  const aBolsa: Bolsa = datos.direccion === 'deposito' ? 'banco' : 'efectivo';

  /*
   * Aviso fuerte pero no bloqueo: si el traspaso deja la bolsa de origen en
   * negativo, casi siempre es la dirección equivocada. No se bloquea del todo
   * porque durante una captura atrasada el orden de los registros puede dejar
   * la bolsa temporalmente corta.
   */
  const caja = await saldoDeCaja(Number(datos.fecha.slice(0, 4)));
  const saldoOrigen = deBolsa === 'banco' ? caja.banco : caja.efectivo;
  if (datos.monto > saldoOrigen + 100_000_00) {
    throw new ErrorDeNegocio(
      `El traspaso (${formatoMXN(datos.monto)}) es mucho mayor que lo que hay en ` +
        `${deBolsa} (${formatoMXN(saldoOrigen)}). Revisa la dirección y el monto.`,
      'monto',
    );
  }

  let archivoId: number | null = null;
  if (ficha) {
    const guardado = await guardarComprobante(ficha, usuarioId, datos.fecha);
    archivoId = guardado.id;
  }

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'traspaso_nuevo');

    const id = await insertarTraspaso(
      tx,
      {
        fecha: datos.fecha,
        deBolsa,
        aBolsa,
        montoCentavos: datos.monto,
        descripcion: datos.descripcion,
        archivoId,
      },
      usuarioId,
    );

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'traspaso_registrado',
      entidad: 'traspaso',
      entidadId: id,
      detalle: {
        de: deBolsa,
        a: aBolsa,
        monto: formatoMXN(datos.monto),
        fecha: datos.fecha,
        con_ficha: archivoId !== null,
      },
    });

    return id;
  }, usuarioId);
}
