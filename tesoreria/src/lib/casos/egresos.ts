/*
 * Casos de uso de egresos.
 *
 * Reglas que se sostienen aquí y en la base, no solo en la interfaz:
 *
 * - Un egreso necesita dos firmas: tesorero y Venerable Maestro. El V∴M∴ puede
 *   cubrir la del tesorero dejando constancia del motivo, nunca al revés.
 * - El dinero sale de la caja exactamente al registrar la entrega, ni antes ni
 *   después, y esa entrega solo procede si el egreso está autorizado.
 * - Todo egreso pagado directo lleva imagen del comprobante de pago. Los que se
 *   entregan por comprobar cierran con recibos más devolución igual a lo entregado.
 * - El pago a la Gran Tesorería lleva además el cálculo que ella misma envía.
 */
import { esNivelVM } from '../tipos';
import { guardarComprobante } from '../archivos';
import { registrarEn } from '../bitacora';
import { consumirNonce } from '../csrf';
import { enTransaccion, unaFila, type Tx } from '../db';
import { conceptoPorClave, obtenerConcepto } from '../datos/conceptos';
import {
  cuentaFirmas,
  insertarDocumento,
  insertarEgreso,
  insertarFirma,
  tieneDocumento,
  type EstadoEgreso,
} from '../datos/egresos';
import { obligacionesLigadasAEgreso } from '../datos/gt';
import { insertarMovimiento } from '../datos/movimientos';
import { formatoMXN } from '../dinero';
import { hoyISO } from '../fechas';
import { ErrorDeNegocio } from '../errores';
import type {
  esquemaComprobacion,
  esquemaCorreccion,
  esquemaDevolucion,
  esquemaDocumento,
  esquemaEgreso,
  esquemaEntrega,
} from '../esquemas/egreso';
import type { Sesion } from '../sesion';
import type { z } from 'zod';

type DatosEgreso = z.infer<typeof esquemaEgreso>;
type DatosEntrega = z.infer<typeof esquemaEntrega>;
type DatosComprobacion = z.infer<typeof esquemaComprobacion>;
type DatosDevolucion = z.infer<typeof esquemaDevolucion>;
type DatosDocumento = z.infer<typeof esquemaDocumento>;

interface Contexto {
  sesion: Sesion;
  nonce: string;
  idPeticion: string;
}

/**
 * El alta de un egreso llega desde dos pantallas distintas, y cada una emite su
 * nonce con su propio propósito. Por eso el propósito viaja explícito: si se
 * asumiera uno fijo, la otra pantalla fallaría con un mensaje de formulario
 * reenviado que no explica nada.
 */
interface ContextoAlta extends Contexto {
  proposito: 'egreso_nuevo' | 'egreso_gran_tesoreria';
}

const esVM = (s: Sesion): boolean => esNivelVM(s.usuario.rol);

/** Estado del egreso con bloqueo de fila, para decidir sin carreras. */
async function egresoParaEditar(
  tx: Tx,
  id: number,
): Promise<{
  id: number;
  folio: string;
  estado: EstadoEgreso;
  requiere_comprobacion: boolean;
  monto_solicitado_centavos: number;
  monto_autorizado_centavos: number | null;
  monto_entregado_centavos: number | null;
  monto_comprobado_centavos: number;
  monto_devuelto_centavos: number;
  concepto_id: number;
  beneficiario: string;
  descripcion: string;
  hermano_id: number | null;
}> {
  const fila = await tx.unaFila<{
    id: number;
    folio: string;
    estado: EstadoEgreso;
    requiere_comprobacion: boolean;
    monto_solicitado_centavos: number;
    monto_autorizado_centavos: number | null;
    monto_entregado_centavos: number | null;
    monto_comprobado_centavos: number;
    monto_devuelto_centavos: number;
    concepto_id: number;
    beneficiario: string;
    descripcion: string;
    hermano_id: number | null;
  }>(
    `select id, folio, estado, requiere_comprobacion, monto_solicitado_centavos,
            monto_autorizado_centavos, monto_entregado_centavos, monto_comprobado_centavos,
            monto_devuelto_centavos, concepto_id, beneficiario, descripcion, hermano_id
       from egreso where id = $1 for update`,
    [id],
  );
  if (!fila) throw new ErrorDeNegocio('Ese egreso ya no existe.');
  return fila;
}

/** Traduce los errores de la base en mensajes que sirvan a quien captura. */
function comoErrorDeNegocio(error: unknown, campo?: string): never {
  const e = error as { code?: string; message?: string; constraint?: string };
  if (e.code === 'P0001') throw new ErrorDeNegocio(e.message ?? 'No se pudo completar.', campo);
  if (e.code === '23505' && e.constraint === 'egreso_firma_egreso_id_rol_requerido_key') {
    throw new ErrorDeNegocio('Esa firma ya estaba registrada.');
  }
  if (e.code === '23514' && e.constraint === 'solo_vm_suple') {
    throw new ErrorDeNegocio(
      'Solo el Venerable Maestro puede firmar por el tesorero.',
    );
  }
  if (e.code === '23514') {
    throw new ErrorDeNegocio(
      'Los datos no cumplen una regla del egreso, revisa los montos y las fechas.',
      campo,
    );
  }
  throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// Alta
// ─────────────────────────────────────────────────────────────────────────────

export async function crearEgreso(
  ctx: ContextoAlta,
  datos: DatosEgreso,
  archivos: Record<string, File>,
): Promise<{ id: number; folio: string }> {
  const usuarioId = ctx.sesion.usuario.id;

  const concepto = await obtenerConcepto(datos.concepto_id);
  if (!concepto || !concepto.activo) {
    throw new ErrorDeNegocio('El concepto elegido no existe o está desactivado.', 'concepto_id');
  }
  if (concepto.naturaleza !== 'egreso') {
    throw new ErrorDeNegocio('Ese concepto es de ingreso, no de egreso.', 'concepto_id');
  }
  if (concepto.requiere_hermano && datos.hermano_id === null) {
    throw new ErrorDeNegocio(
      `Para "${concepto.nombre}" hay que indicar de qué hermano se trata.`,
      'hermano_id',
    );
  }

  /*
   * Los pagos a la Gran Tesorería ya no se capturan aquí: nacen en el módulo GT
   * como obligaciones y generan su egreso desde allá.
   */
  if (concepto.tipo_especial === 'gran_tesoreria') {
    throw new ErrorDeNegocio(
      'Los pagos a la Gran Tesorería se capturan en su módulo: primero la obligación, ' +
        'después el egreso de pago. Ve a Gran Tesorería.',
      'concepto_id',
    );
  }

  /* Los archivos se guardan antes de abrir la transacción. */
  const guardados: Record<string, number> = {};
  for (const [campo, archivo] of Object.entries(archivos)) {
    const guardado = await guardarComprobante(archivo, usuarioId, datos.fecha_solicitud);
    guardados[campo] = guardado.id;
  }

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, ctx.proposito);

    let creado: { id: number; folio: string };
    try {
      creado = await insertarEgreso(
        tx,
        {
          fecha_solicitud: datos.fecha_solicitud,
          concepto_id: concepto.id,
          beneficiario: datos.beneficiario,
          descripcion: datos.descripcion,
          hermano_id: datos.hermano_id,
          monto_solicitado_centavos: datos.monto,
          requiere_comprobacion: datos.requiere_comprobacion,
          notas: datos.notas,
        },
        usuarioId,
      );
    } catch (error) {
      comoErrorDeNegocio(error);
    }

    if (guardados.calculo !== undefined) {
      await insertarDocumento(
        tx,
        creado.id,
        {
          tipo: 'calculo_gran_tesoreria',
          fecha: datos.fecha_solicitud,
          descripcion: 'Cálculo enviado por la Gran Tesorería',
          archivoId: guardados.calculo,
        },
        usuarioId,
      );
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'egreso_registrado',
      entidad: 'egreso',
      entidadId: creado.id,
      detalle: {
        folio: creado.folio,
        concepto: concepto.clave,
        beneficiario: datos.beneficiario,
        monto: formatoMXN(datos.monto),
        por_comprobar: datos.requiere_comprobacion,
      },
    });

    return creado;
  }, usuarioId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Firmas y autorización
// ─────────────────────────────────────────────────────────────────────────────

export async function firmarEgreso(
  ctx: Contexto,
  id: number,
  datos: { rol_requerido: 'tesorero' | 'venerable_maestro'; motivo_suplencia?: string | undefined },
): Promise<{ autorizado: boolean }> {
  const usuarioId = ctx.sesion.usuario.id;
  const rolFirmante = ctx.sesion.usuario.rol;
  /* El super_admin cubre el lugar del V∴M∴ por nivel: no es suplencia. */
  const cubreDirecto =
    rolFirmante === datos.rol_requerido ||
    (datos.rol_requerido === 'venerable_maestro' && rolFirmante === 'super_admin');
  const esSuplencia = !cubreDirecto;

  if (esSuplencia) {
    if (!esVM(ctx.sesion)) {
      throw new ErrorDeNegocio(
        'Solo el Venerable Maestro puede firmar por el tesorero.',
      );
    }
    if (!datos.motivo_suplencia) {
      throw new ErrorDeNegocio(
        'Para firmar por el tesorero hay que anotar el motivo de la suplencia.',
        'motivo_suplencia',
      );
    }
  }

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'egreso_firma');

    const egreso = await egresoParaEditar(tx, id);
    if (egreso.estado !== 'registrado') {
      throw new ErrorDeNegocio(
        `El egreso ${egreso.folio} ya no está esperando firmas.`,
      );
    }

    try {
      await insertarFirma(
        tx,
        id,
        datos.rol_requerido,
        usuarioId,
        rolFirmante,
        datos.motivo_suplencia ?? null,
      );
    } catch (error) {
      comoErrorDeNegocio(error);
    }

    const firmas = await cuentaFirmas(tx, id);
    let autorizado = false;

    /* Con las dos firmas, el egreso queda autorizado en el mismo acto. */
    if (firmas >= 2) {
      try {
        await tx.consulta(
          `update egreso set estado = 'autorizado',
                  monto_autorizado_centavos = coalesce(monto_autorizado_centavos,
                                                       monto_solicitado_centavos)
            where id = $1`,
          [id],
        );
      } catch (error) {
        comoErrorDeNegocio(error);
      }
      autorizado = true;
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: autorizado ? 'egreso_autorizado' : 'egreso_firmado',
      entidad: 'egreso',
      entidadId: id,
      detalle: {
        folio: egreso.folio,
        firma: datos.rol_requerido,
        firmante: ctx.sesion.usuario.nombre,
        suplencia: esSuplencia,
        motivo_suplencia: esSuplencia ? datos.motivo_suplencia : null,
        firmas_totales: firmas,
      },
    });

    return { autorizado };
  }, usuarioId);
}

export async function rechazarEgreso(
  ctx: Contexto,
  id: number,
  motivo: string,
): Promise<void> {
  await cambiarEstadoSimple(ctx, id, 'rechazado', motivo);
}

export async function cancelarEgreso(
  ctx: Contexto,
  id: number,
  motivo: string,
): Promise<void> {
  await cambiarEstadoSimple(ctx, id, 'cancelado', motivo);
}

async function cambiarEstadoSimple(
  ctx: Contexto,
  id: number,
  destino: 'rechazado' | 'cancelado',
  motivo: string,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;
  const proposito = destino === 'rechazado' ? 'egreso_rechazo' : 'egreso_cancelacion';

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, proposito);
    const egreso = await egresoParaEditar(tx, id);

    try {
      await tx.consulta(
        destino === 'rechazado'
          ? `update egreso set estado = 'rechazado', motivo_rechazo = $2 where id = $1`
          : `update egreso set estado = 'cancelado', motivo_cancelacion = $2 where id = $1`,
        [id, motivo],
      );
    } catch (error) {
      comoErrorDeNegocio(error, 'motivo');
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: destino === 'rechazado' ? 'egreso_rechazado' : 'egreso_cancelado',
      entidad: 'egreso',
      entidadId: id,
      detalle: { folio: egreso.folio, motivo },
    });
  }, usuarioId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrega del dinero
// ─────────────────────────────────────────────────────────────────────────────

export async function registrarEntrega(
  ctx: Contexto,
  id: number,
  datos: DatosEntrega,
  comprobante: File | undefined,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  const previo = await unaFila<{
    estado: EstadoEgreso;
    requiere_comprobacion: boolean;
    concepto_id: number;
    folio: string;
  }>(
    'select estado, requiere_comprobacion, concepto_id, folio from egreso where id = $1',
    [id],
  );
  if (!previo) throw new ErrorDeNegocio('Ese egreso ya no existe.');
  if (previo.estado !== 'autorizado') {
    throw new ErrorDeNegocio(
      `El egreso ${previo.folio} no está autorizado, no se puede entregar el dinero.`,
    );
  }

  const concepto = await obtenerConcepto(previo.concepto_id);
  if (!concepto) throw new Error('El egreso apunta a un concepto que no existe.');

  /*
   * Un egreso pagado directo necesita imagen del comprobante. Los que se entregan
   * por comprobar pueden no tenerla en ese momento, y por eso cierran con recibos.
   */
  if (!previo.requiere_comprobacion && !comprobante) {
    throw new ErrorDeNegocio(
      'Sube la imagen del comprobante de pago: es obligatoria para cerrar un egreso pagado.',
      'comprobante',
    );
  }

  let archivoId: number | null = null;
  if (comprobante) {
    const guardado = await guardarComprobante(comprobante, usuarioId, datos.fecha_entrega);
    archivoId = guardado.id;
  }

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'egreso_entrega');

    const egreso = await egresoParaEditar(tx, id);
    if (egreso.estado !== 'autorizado') {
      throw new ErrorDeNegocio(`El egreso ${egreso.folio} ya fue entregado.`);
    }
    if (datos.monto_entregado > (egreso.monto_autorizado_centavos ?? 0)) {
      throw new ErrorDeNegocio(
        `Lo entregado (${formatoMXN(datos.monto_entregado)}) pasa de lo autorizado ` +
          `(${formatoMXN(egreso.monto_autorizado_centavos ?? 0)}).`,
        'monto_entregado',
      );
    }

    if (archivoId !== null) {
      await insertarDocumento(
        tx,
        id,
        {
          tipo: 'comprobante_pago',
          fecha: datos.fecha_entrega,
          descripcion: datos.descripcion_pago ?? 'Comprobante del pago',
          archivoId,
        },
        usuarioId,
      );
    }

    /*
     * Si el egreso nació del dominio GT, la entrega tiene que cubrir exactamente
     * las obligaciones ligadas: pagar otra cantidad rompería la aplicación.
     */
    const ligadas = await obligacionesLigadasAEgreso(tx, id);
    const totalLigado = ligadas.reduce((s, l) => s + l.monto_centavos, 0);
    if (ligadas.length > 0 && datos.monto_entregado !== totalLigado) {
      throw new ErrorDeNegocio(
        `Este egreso paga obligaciones GT por ${formatoMXN(totalLigado)}: la entrega ` +
          'debe ser exactamente esa cantidad. Si la Gran Tesorería cobró distinto, ' +
          'corrige la obligación antes de pagar.',
        'monto_entregado',
      );
    }

    const movimientoId = await insertarMovimiento(
      tx,
      {
        fecha: datos.fecha_entrega,
        tipo: 'egreso',
        bolsa: datos.bolsa,
        conceptoId: egreso.concepto_id,
        montoCentavos: datos.monto_entregado,
        descripcion: `${egreso.folio} · ${egreso.descripcion}`,
        hermanoId: egreso.hermano_id,
        egresoId: id,
        archivoId,
      },
      usuarioId,
    );

    let pagoGTFolio: string | null = null;
    if (ligadas.length > 0) {
      const anioPago = Number(datos.fecha_entrega.slice(0, 4));
      const folioPago = await tx.laFila<{ folio: string }>(
        'select fn_gt_folio_pago($1) as folio',
        [anioPago],
      );
      const pago = await tx.laFila<{ id: number }>(
        `insert into gt_pago
           (folio, fecha_pago, monto_centavos, bolsa, medio_pago, movimiento_id,
            recibo_gt_id, creado_por)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning id`,
        [
          folioPago.folio,
          datos.fecha_entrega,
          datos.monto_entregado,
          datos.bolsa,
          datos.bolsa === 'banco' ? 'transferencia' : 'efectivo',
          movimientoId,
          archivoId,
          usuarioId,
        ],
      );
      for (const liga of ligadas) {
        await tx.consulta(
          `insert into gt_pago_aplicacion (pago_id, obligacion_id, monto_centavos, creado_por)
           values ($1, $2, $3, $4)`,
          [pago.id, liga.obligacion_id, liga.monto_centavos, usuarioId],
        );
      }
      pagoGTFolio = folioPago.folio;
    }

    const destino = egreso.requiere_comprobacion ? 'por_comprobar' : 'pagado';

    try {
      await tx.consulta(
        `update egreso set estado = $2, monto_entregado_centavos = $3, fecha_entrega = $4
          where id = $1`,
        [id, destino, datos.monto_entregado, datos.fecha_entrega],
      );
    } catch (error) {
      comoErrorDeNegocio(error, 'monto_entregado');
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'egreso_entregado',
      entidad: 'egreso',
      entidadId: id,
      detalle: {
        folio: egreso.folio,
        monto: formatoMXN(datos.monto_entregado),
        fecha: datos.fecha_entrega,
        estado: destino,
        movimiento_id: movimientoId,
        con_comprobante: archivoId !== null,
        pago_gt: pagoGTFolio,
      },
    });
  }, usuarioId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Comprobación
// ─────────────────────────────────────────────────────────────────────────────

export async function agregarComprobacion(
  ctx: Contexto,
  id: number,
  datos: DatosComprobacion,
  archivo: File | undefined,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  if (!archivo) {
    throw new ErrorDeNegocio(
      'Sube la imagen del recibo: sin ella no comprueba nada.',
      'archivo',
    );
  }

  const guardado = await guardarComprobante(archivo, usuarioId, datos.fecha);

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'egreso_comprobacion');

    const egreso = await egresoParaEditar(tx, id);
    if (egreso.estado !== 'por_comprobar') {
      throw new ErrorDeNegocio(
        `El egreso ${egreso.folio} no está esperando comprobación.`,
      );
    }

    const falta =
      (egreso.monto_entregado_centavos ?? 0) -
      egreso.monto_comprobado_centavos -
      egreso.monto_devuelto_centavos;

    if (datos.monto > falta) {
      throw new ErrorDeNegocio(
        `Ese recibo (${formatoMXN(datos.monto)}) pasa de lo que falta por comprobar ` +
          `(${formatoMXN(falta)}).`,
        'monto',
      );
    }

    await insertarDocumento(
      tx,
      id,
      {
        tipo: datos.tipo,
        fecha: datos.fecha,
        montoCentavos: datos.monto,
        descripcion: datos.descripcion ?? null,
        archivoId: guardado.id,
      },
      usuarioId,
    );

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'egreso_comprobacion_agregada',
      entidad: 'egreso',
      entidadId: id,
      detalle: {
        folio: egreso.folio,
        tipo: datos.tipo,
        monto: formatoMXN(datos.monto),
      },
    });
  }, usuarioId);
}

export async function registrarDevolucion(
  ctx: Contexto,
  id: number,
  datos: DatosDevolucion,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  const concepto = await conceptoPorClave('devolucion_por_comprobar');
  if (!concepto) {
    throw new Error(
      'Falta el concepto "devolucion_por_comprobar" en el catálogo, revisa las migraciones.',
    );
  }

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'egreso_devolucion');

    const egreso = await egresoParaEditar(tx, id);
    if (egreso.estado !== 'por_comprobar') {
      throw new ErrorDeNegocio(
        `El egreso ${egreso.folio} no está esperando comprobación.`,
      );
    }

    const falta =
      (egreso.monto_entregado_centavos ?? 0) -
      egreso.monto_comprobado_centavos -
      egreso.monto_devuelto_centavos;

    if (datos.monto > falta) {
      throw new ErrorDeNegocio(
        `La devolución (${formatoMXN(datos.monto)}) pasa de lo que falta por comprobar ` +
          `(${formatoMXN(falta)}).`,
        'monto',
      );
    }

    /* La devolución es dinero que regresa a la caja. */
    const movimientoId = await insertarMovimiento(
      tx,
      {
        fecha: datos.fecha,
        tipo: 'ingreso',
        bolsa: datos.bolsa,
        conceptoId: concepto.id,
        montoCentavos: datos.monto,
        descripcion: `Devolución de ${egreso.folio} · ${egreso.beneficiario}`,
        egresoId: id,
      },
      usuarioId,
    );

    await tx.consulta(
      `update egreso set monto_devuelto_centavos = monto_devuelto_centavos + $2
        where id = $1`,
      [id, datos.monto],
    );

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'egreso_devolucion',
      entidad: 'egreso',
      entidadId: id,
      detalle: {
        folio: egreso.folio,
        monto: formatoMXN(datos.monto),
        movimiento_id: movimientoId,
      },
    });
  }, usuarioId);
}

export async function cerrarComprobacion(
  ctx: Contexto,
  id: number,
  fecha: string,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'egreso_cierre');

    const egreso = await egresoParaEditar(tx, id);
    if (egreso.estado !== 'por_comprobar') {
      throw new ErrorDeNegocio(`El egreso ${egreso.folio} no está por comprobar.`);
    }

    const entregado = egreso.monto_entregado_centavos ?? 0;
    const cubierto = egreso.monto_comprobado_centavos + egreso.monto_devuelto_centavos;

    if (cubierto !== entregado) {
      throw new ErrorDeNegocio(
        `Todavía no cuadra: se entregaron ${formatoMXN(entregado)}, hay ` +
          `${formatoMXN(egreso.monto_comprobado_centavos)} en recibos y ` +
          `${formatoMXN(egreso.monto_devuelto_centavos)} devueltos. ` +
          `Faltan ${formatoMXN(entregado - cubierto)} por comprobar o devolver.`,
      );
    }

    try {
      await tx.consulta(
        `update egreso set estado = 'comprobado', fecha_comprobacion = $2 where id = $1`,
        [id, fecha],
      );
    } catch (error) {
      comoErrorDeNegocio(error);
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'egreso_comprobado',
      entidad: 'egreso',
      entidadId: id,
      detalle: {
        folio: egreso.folio,
        entregado: formatoMXN(entregado),
        comprobado: formatoMXN(egreso.monto_comprobado_centavos),
        devuelto: formatoMXN(egreso.monto_devuelto_centavos),
      },
    });
  }, usuarioId);
}

/** Documento suelto: el cálculo de la Gran Tesorería, el comprobante de pago, otro. */
export async function agregarDocumento(
  ctx: Contexto,
  id: number,
  datos: DatosDocumento,
  archivo: File | undefined,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  if (!archivo) {
    throw new ErrorDeNegocio('Elige el archivo que quieres adjuntar.', 'archivo');
  }

  const guardado = await guardarComprobante(archivo, usuarioId, datos.fecha);

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'egreso_documento');

    const egreso = await egresoParaEditar(tx, id);

    await insertarDocumento(
      tx,
      id,
      {
        tipo: datos.tipo,
        fecha: datos.fecha,
        descripcion: datos.descripcion ?? null,
        archivoId: guardado.id,
      },
      usuarioId,
    );

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'egreso_documento_agregado',
      entidad: 'egreso',
      entidadId: id,
      detalle: { folio: egreso.folio, tipo: datos.tipo },
    });
  }, usuarioId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Corrección de captura
// ─────────────────────────────────────────────────────────────────────────────

/*
 * El primer año se captura en paralelo a los exceles y hay errores de captura.
 * Estas correcciones los arreglan sin tocar montos: lo que cambia es cómo se
 * llamó, cuándo pasó y a qué concepto va. Son del nivel V∴M∴ y dejan en la
 * bitácora el antes y el después. En la base, un egreso cerrado solo acepta
 * estos cambios si la transacción se declara corrección (migración 025).
 */

const declararCorreccion = (tx: Tx): Promise<unknown> =>
  tx.consulta(`select set_config('tesoreria.correccion', 'on', true)`);

function exigirVM(sesion: Sesion): void {
  if (!esVM(sesion)) {
    throw new ErrorDeNegocio('Las correcciones de captura las hace el Venerable Maestro.');
  }
}

export async function corregirEgreso(
  ctx: Contexto,
  id: number,
  datos: z.infer<typeof esquemaCorreccion>,
): Promise<void> {
  exigirVM(ctx.sesion);
  const usuarioId = ctx.sesion.usuario.id;
  const hoy = hoyISO();

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'egreso_correccion');

    const egreso = await tx.unaFila<{
      folio: string;
      estado: EstadoEgreso;
      ejercicio_anio: number;
      concepto_id: number;
      beneficiario: string;
      descripcion: string;
      hermano_id: number | null;
      fecha_solicitud: string;
      fecha_entrega: string | null;
      fecha_comprobacion: string | null;
    }>(
      `select folio, estado, ejercicio_anio, concepto_id, beneficiario, descripcion,
              hermano_id, fecha_solicitud::text, fecha_entrega::text,
              fecha_comprobacion::text
         from egreso where id = $1 for update`,
      [id],
    );
    if (!egreso) throw new ErrorDeNegocio('Ese egreso ya no existe.');

    /* Lo que el egreso no tiene, no se inventa: sin entrega no hay fecha de entrega. */
    const nuevo = {
      concepto_id: datos.concepto_id ?? egreso.concepto_id,
      beneficiario: datos.beneficiario,
      descripcion: datos.descripcion,
      fecha_solicitud: datos.fecha_solicitud,
      fecha_entrega: egreso.fecha_entrega ? (datos.fecha_entrega ?? egreso.fecha_entrega) : null,
      fecha_comprobacion: egreso.fecha_comprobacion
        ? (datos.fecha_comprobacion ?? egreso.fecha_comprobacion)
        : null,
    };

    const anio = String(egreso.ejercicio_anio);
    const fechas: [keyof typeof nuevo, string | null, string][] = [
      ['fecha_solicitud', nuevo.fecha_solicitud, 'La fecha de solicitud'],
      ['fecha_entrega', nuevo.fecha_entrega, 'La fecha de entrega'],
      ['fecha_comprobacion', nuevo.fecha_comprobacion, 'La fecha de comprobación'],
    ];
    for (const [campo, fecha, etiqueta] of fechas) {
      if (fecha === null) continue;
      if (fecha > hoy) throw new ErrorDeNegocio(`${etiqueta} no puede ser futura.`, campo);
      if (fecha.slice(0, 4) !== anio) {
        throw new ErrorDeNegocio(
          `${etiqueta} tiene que caer en ${anio}, el ejercicio del folio ${egreso.folio}.`,
          campo,
        );
      }
    }
    if (nuevo.fecha_entrega && nuevo.fecha_entrega < nuevo.fecha_solicitud) {
      throw new ErrorDeNegocio(
        'La entrega no puede ser anterior a la solicitud.',
        'fecha_entrega',
      );
    }
    if (
      nuevo.fecha_comprobacion &&
      nuevo.fecha_entrega &&
      nuevo.fecha_comprobacion < nuevo.fecha_entrega
    ) {
      throw new ErrorDeNegocio(
        'La comprobación no puede ser anterior a la entrega.',
        'fecha_comprobacion',
      );
    }

    if (nuevo.concepto_id !== egreso.concepto_id) {
      const ligadas = await obligacionesLigadasAEgreso(tx, id);
      const actual = await obtenerConcepto(egreso.concepto_id);
      if (ligadas.length > 0 || actual?.tipo_especial === 'gran_tesoreria') {
        throw new ErrorDeNegocio(
          'Este egreso paga a la Gran Tesorería: su concepto va ligado a las obligaciones y no se cambia.',
          'concepto_id',
        );
      }
      const concepto = await obtenerConcepto(nuevo.concepto_id);
      if (!concepto || !concepto.activo || concepto.naturaleza !== 'egreso') {
        throw new ErrorDeNegocio('Elige un concepto de egreso activo.', 'concepto_id');
      }
      if (concepto.tipo_especial === 'gran_tesoreria') {
        throw new ErrorDeNegocio(
          'Los pagos a la Gran Tesorería nacen de una obligación, no de un cambio de concepto.',
          'concepto_id',
        );
      }
      if (concepto.requiere_hermano && egreso.hermano_id === null) {
        throw new ErrorDeNegocio(
          `"${concepto.nombre}" exige un hermano y este egreso no lo tiene.`,
          'concepto_id',
        );
      }
    }

    const antes: Record<string, unknown> = {};
    const despues: Record<string, unknown> = {};
    for (const campo of Object.keys(nuevo) as (keyof typeof nuevo)[]) {
      if (nuevo[campo] !== egreso[campo]) {
        antes[campo] = egreso[campo];
        despues[campo] = nuevo[campo];
      }
    }
    if (Object.keys(despues).length === 0) {
      throw new ErrorDeNegocio('No hay nada distinto que guardar.');
    }

    await declararCorreccion(tx);
    try {
      await tx.consulta(
        `update egreso
            set concepto_id = $2, beneficiario = $3, descripcion = $4,
                fecha_solicitud = $5, fecha_entrega = $6, fecha_comprobacion = $7,
                actualizado_por = $8
          where id = $1`,
        [
          id,
          nuevo.concepto_id,
          nuevo.beneficiario,
          nuevo.descripcion,
          nuevo.fecha_solicitud,
          nuevo.fecha_entrega,
          nuevo.fecha_comprobacion,
          usuarioId,
        ],
      );

      /*
       * La salida del libro sigue al egreso: misma fecha de entrega, mismo
       * concepto y la descripción con su folio. Si el mes ya tiene corte
       * cerrado, la base lo impide y el mensaje lo explica.
       */
      if (nuevo.fecha_entrega) {
        const movido = await tx.unaFila<{ id: number }>(
          `update movimiento
              set fecha = $2, periodo = date_trunc('month', $2::date)::date,
                  concepto_id = $3, descripcion = $4, actualizado_por = $5
            where egreso_id = $1 and tipo = 'egreso'
            returning id`,
          [id, nuevo.fecha_entrega, nuevo.concepto_id, `${egreso.folio} · ${nuevo.descripcion}`, usuarioId],
        );
        if (movido) {
          await tx.consulta('update gt_pago set fecha_pago = $2 where movimiento_id = $1', [
            movido.id,
            nuevo.fecha_entrega,
          ]);
        }
      }
    } catch (error) {
      comoErrorDeNegocio(error);
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'egreso_corregido',
      entidad: 'egreso',
      entidadId: id,
      detalle: {
        folio: egreso.folio,
        antes,
        despues,
        motivo: datos.motivo_correccion ?? null,
      },
    });
  }, usuarioId);
}

/** Edita el motivo de la suplencia del tesorero; en blanco lo limpia, con constancia. */
export async function corregirMotivoSuplencia(
  ctx: Contexto,
  id: number,
  motivo: string | undefined,
): Promise<void> {
  exigirVM(ctx.sesion);
  const usuarioId = ctx.sesion.usuario.id;

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'egreso_suplencia');

    const firma = await tx.unaFila<{ id: number; folio: string; motivo_suplencia: string | null }>(
      `select f.id, e.folio, f.motivo_suplencia
         from egreso_firma f
         join egreso e on e.id = f.egreso_id
        where f.egreso_id = $1 and f.rol_requerido = 'tesorero' and f.es_suplencia
        for update of f`,
      [id],
    );
    if (!firma) throw new ErrorDeNegocio('Este egreso no tiene suplencia del tesorero.');
    if ((firma.motivo_suplencia ?? undefined) === motivo) {
      throw new ErrorDeNegocio('El motivo ya dice eso.', 'motivo_suplencia');
    }

    if (motivo === undefined) {
      await tx.consulta(
        `update egreso_firma
            set motivo_suplencia = null, motivo_limpiado_por = $2, motivo_limpiado_en = now()
          where id = $1`,
        [firma.id, usuarioId],
      );
    } else {
      await tx.consulta(
        `update egreso_firma
            set motivo_suplencia = $2, motivo_limpiado_por = null, motivo_limpiado_en = null
          where id = $1`,
        [firma.id, motivo],
      );
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: motivo === undefined ? 'suplencia_motivo_limpiado' : 'suplencia_motivo_editado',
      entidad: 'egreso',
      entidadId: id,
      detalle: { folio: firma.folio, antes: firma.motivo_suplencia, despues: motivo ?? null },
    });
  }, usuarioId);
}

/**
 * Un mismo beneficiario escrito de dos maneras ("M∴R∴G∴L∴ Valle de México" y
 * "Gran Logia Valle de México") se unifica en todos sus egresos de una vez.
 */
export async function unificarBeneficiario(
  ctx: Contexto,
  de: string,
  a: string,
): Promise<number> {
  exigirVM(ctx.sesion);
  const usuarioId = ctx.sesion.usuario.id;
  if (de === a) throw new ErrorDeNegocio('Los dos nombres son iguales.', 'a');

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'egreso_beneficiarios');
    await declararCorreccion(tx);

    const cambiados = await tx.consulta<{ folio: string }>(
      `update egreso set beneficiario = $2, actualizado_por = $3
        where beneficiario = $1
        returning folio`,
      [de, a, usuarioId],
    );
    if (cambiados.length === 0) {
      throw new ErrorDeNegocio('Ya no hay egresos con ese beneficiario.', 'de');
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'beneficiario_unificado',
      entidad: 'egreso',
      detalle: { de, a, folios: cambiados.map((c) => c.folio) },
    });

    return cambiados.length;
  }, usuarioId);
}
