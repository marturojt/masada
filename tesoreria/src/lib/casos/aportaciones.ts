/*
 * Aportaciones extraordinarias.
 *
 * La monetaria es un ingreso normal: mueve la caja, genera movimiento y recibo.
 * La aportación en especie se registra para trazabilidad con su constancia
 * (APO-), pero JAMÁS toca el libro de caja: ni ingreso ficticio ni egreso
 * ficticio, y su valor estimado queda fuera de todo saldo.
 */
import { guardarComprobante } from '../archivos';
import { registrarEn } from '../bitacora';
import { consumirNonce } from '../csrf';
import { consulta, enTransaccion, unaFila } from '../db';
import { conceptoPorClave } from '../datos/conceptos';
import { insertarMovimiento } from '../datos/movimientos';
import { formatoMXN } from '../dinero';
import { ErrorDeNegocio } from '../errores';
import type { Bolsa } from '../tipos';
import type { Sesion } from '../sesion';

interface Contexto {
  sesion: Sesion;
  nonce: string;
  idPeticion: string;
}

export interface AportacionFila {
  id: number;
  tipo: 'monetaria' | 'especie';
  folio: string | null;
  hermano_id: number | null;
  aportante_nombre: string;
  fecha: string;
  descripcion: string;
  destino: string | null;
  cantidad: string | null;
  unidad: string | null;
  valor_estimado_centavos: number | null;
  movimiento_id: number | null;
  documento_id: number | null;
}

export const listarAportaciones = (anio: number): Promise<AportacionFila[]> =>
  consulta<AportacionFila>(
    `select a.id, a.tipo, a.folio, a.hermano_id, a.aportante_nombre, a.fecha::text,
            a.descripcion, a.destino, a.cantidad::text, a.unidad,
            a.valor_estimado_centavos, a.movimiento_id, a.documento_id
       from aportacion a
      where extract(year from a.fecha)::int = $1
      order by a.fecha desc, a.id desc`,
    [anio],
  );

export const obtenerAportacion = (id: number): Promise<AportacionFila | null> =>
  unaFila<AportacionFila>(
    `select a.id, a.tipo, a.folio, a.hermano_id, a.aportante_nombre, a.fecha::text,
            a.descripcion, a.destino, a.cantidad::text, a.unidad,
            a.valor_estimado_centavos, a.movimiento_id, a.documento_id
       from aportacion a where a.id = $1`,
    [id],
  );

export async function registrarAportacionMonetaria(
  ctx: Contexto,
  datos: {
    fecha: string;
    monto: number;
    bolsa: Bolsa;
    hermano_id: number | null;
    aportante_nombre: string;
    descripcion: string;
    destino?: string | undefined;
  },
  comprobante: File | undefined,
): Promise<{ id: number; movimientoId: number }> {
  const usuarioId = ctx.sesion.usuario.id;

  const concepto = await conceptoPorClave('donativo');
  if (!concepto) throw new Error('Falta el concepto donativo en el catálogo.');

  let archivoId: number | null = null;
  if (comprobante) {
    const guardado = await guardarComprobante(comprobante, usuarioId, datos.fecha);
    archivoId = guardado.id;
  }

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'aportacion_monetaria');

    const movimientoId = await insertarMovimiento(
      tx,
      {
        fecha: datos.fecha,
        tipo: 'ingreso',
        bolsa: datos.bolsa,
        conceptoId: concepto.id,
        montoCentavos: datos.monto,
        descripcion: `Aportación de ${datos.aportante_nombre}: ${datos.descripcion}`,
        hermanoId: datos.hermano_id,
        archivoId,
      },
      usuarioId,
    );

    const fila = await tx.laFila<{ id: number }>(
      `insert into aportacion
         (tipo, hermano_id, aportante_nombre, fecha, descripcion, destino,
          movimiento_id, documento_id, creado_por)
       values ('monetaria', $1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [
        datos.hermano_id,
        datos.aportante_nombre,
        datos.fecha,
        datos.descripcion,
        datos.destino ?? null,
        movimientoId,
        archivoId,
        usuarioId,
      ],
    );

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'aportacion_monetaria',
      entidad: 'aportacion',
      entidadId: fila.id,
      detalle: {
        aportante: datos.aportante_nombre,
        monto: formatoMXN(datos.monto),
        destino: datos.destino ?? null,
      },
    });

    return { id: fila.id, movimientoId };
  }, usuarioId);
}

export async function registrarAportacionEspecie(
  ctx: Contexto,
  datos: {
    fecha: string;
    hermano_id: number | null;
    aportante_nombre: string;
    descripcion: string;
    destino?: string | undefined;
    cantidad: number;
    unidad?: string | undefined;
    valor_estimado?: number | null;
  },
  evidencia: File | undefined,
): Promise<{ id: number; folio: string }> {
  const usuarioId = ctx.sesion.usuario.id;

  let archivoId: number | null = null;
  if (evidencia) {
    const guardado = await guardarComprobante(evidencia, usuarioId, datos.fecha);
    archivoId = guardado.id;
  }

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'aportacion_especie');

    const anio = Number(datos.fecha.slice(0, 4));
    const folio = await tx.laFila<{ folio: string }>(
      'select fn_folio_aportacion($1) as folio',
      [anio],
    );

    const fila = await tx.laFila<{ id: number }>(
      `insert into aportacion
         (tipo, folio, hermano_id, aportante_nombre, fecha, descripcion, destino,
          cantidad, unidad, valor_estimado_centavos, documento_id, creado_por)
       values ('especie', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       returning id`,
      [
        folio.folio,
        datos.hermano_id,
        datos.aportante_nombre,
        datos.fecha,
        datos.descripcion,
        datos.destino ?? null,
        datos.cantidad,
        datos.unidad ?? null,
        datos.valor_estimado ?? null,
        archivoId,
        usuarioId,
      ],
    );

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'aportacion_especie',
      entidad: 'aportacion',
      entidadId: fila.id,
      detalle: {
        folio: folio.folio,
        aportante: datos.aportante_nombre,
        cantidad: datos.cantidad,
        unidad: datos.unidad ?? null,
        valor_estimado:
          datos.valor_estimado != null ? formatoMXN(datos.valor_estimado) : null,
      },
    });

    return { id: fila.id, folio: folio.folio };
  }, usuarioId);
}
