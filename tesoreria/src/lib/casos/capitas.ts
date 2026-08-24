/*
 * Casos de uso de cápitas.
 *
 * La regla de cuántos meses corresponden y qué pasa al cambiar de modalidad vive
 * en la función fn_asignar_capita de la base, no aquí: así no hay dos versiones
 * de la misma regla y el invariante se sostiene aunque alguien escriba desde
 * psql.
 */
import { guardarComprobante } from '../archivos';
import { registrarEn } from '../bitacora';
import { consumirNonce } from '../csrf';
import { enTransaccion, unaFila } from '../db';
import {
  aplicarACargo,
  asignarCapitaEnBase,
  cargosConSaldo,
  cargosConSaldoAbiertos,
  condonarCargo,
  pagosConRestante,
  saldoAFavorDisponible,
  type Modalidad,
} from '../datos/capitas';
import { insertarEgreso } from '../datos/egresos';
import { conceptoPorClave } from '../datos/conceptos';
import { insertarMovimiento } from '../datos/movimientos';
import { formatoMXN } from '../dinero';
import { ErrorDeNegocio } from '../errores';
import { hoyISO, nombrePeriodoCorto } from '../fechas';
import type { DatosExencion, DatosModalidad, DatosPagoCapita } from '../esquemas/capita';
import type { Sesion } from '../sesion';

interface Contexto {
  sesion: Sesion;
  nonce: string;
  anio: number;
  idPeticion: string;
}

/**
 * Traduce los errores que levanta la función de la base. Sus mensajes ya están
 * escritos en español y pensados para el tesorero, así que se pasan tal cual en
 * lugar de reemplazarlos por algo más pobre.
 */
function comoErrorDeNegocio(error: unknown, campo?: string): never {
  const codigo = (error as { code?: string }).code;
  /* P0001 es raise_exception de plpgsql: es una regla de negocio, no una falla. */
  if (codigo === 'P0001') {
    const mensaje = (error as { message?: string }).message ?? 'No se pudo completar.';
    throw new ErrorDeNegocio(mensaje, campo);
  }
  throw error;
}

export async function asignarModalidad(
  ctx: Contexto,
  datos: DatosModalidad,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;
  const esVM = ctx.sesion.usuario.rol === 'venerable_maestro';

  /* La promoción es discrecional del Venerable Maestro. */
  if (datos.modalidad === 'promocion' && !esVM) {
    throw new ErrorDeNegocio(
      'La promoción de pago único la autoriza el Venerable Maestro. Pídele que la habilite.',
      'modalidad',
    );
  }

  const hermano = await unaFila<{ nombre_completo: string }>(
    'select nombre_completo from hermano where id = $1',
    [datos.hermano_id],
  );
  if (!hermano) throw new ErrorDeNegocio('Ese hermano no está en el padrón.', 'hermano_id');

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'capita_modalidad');

    let planId: number;
    try {
      planId = await asignarCapitaEnBase(
        tx,
        datos.hermano_id,
        ctx.anio,
        datos.modalidad as Modalidad,
        datos.mes_promocion ?? null,
        datos.modalidad === 'promocion' ? usuarioId : null,
        datos.motivo ?? null,
      );
    } catch (error) {
      comoErrorDeNegocio(error, 'modalidad');
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'capita_modalidad_asignada',
      entidad: 'capita_plan',
      entidadId: planId,
      detalle: {
        hermano: hermano.nombre_completo,
        modalidad: datos.modalidad,
        mes_promocion: datos.mes_promocion ?? null,
        motivo: datos.motivo ?? null,
      },
    });
  }, usuarioId);
}

export interface ResultadoPago {
  movimientoId: number;
  aplicado: number;
  sinAplicar: number;
  meses: string[];
}

/**
 * Registra un pago de cápita y lo aplica del mes más antiguo con saldo hacia
 * adelante. Lo que sobra queda visible como saldo a favor: ni se pierde ni se
 * adelanta a un mes que el hermano no pidió cubrir.
 */
export async function registrarPagoCapita(
  ctx: Contexto,
  datos: DatosPagoCapita,
  comprobante: File | undefined,
): Promise<ResultadoPago> {
  const usuarioId = ctx.sesion.usuario.id;

  const hermano = await unaFila<{ nombre_completo: string; estatus: string }>(
    'select nombre_completo, estatus from hermano where id = $1',
    [datos.hermano_id],
  );
  if (!hermano) throw new ErrorDeNegocio('Ese hermano no está en el padrón.', 'hermano_id');

  const concepto = await conceptoPorClave('capita');
  if (!concepto) {
    throw new Error('Falta el concepto "capita" en el catálogo, revisa las migraciones.');
  }

  let archivoId: number | null = null;
  if (comprobante) {
    const guardado = await guardarComprobante(comprobante, usuarioId, datos.fecha);
    archivoId = guardado.id;
  }

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'capita_pago');

    const pendientes = await cargosConSaldo(tx, datos.hermano_id, ctx.anio);
    if (pendientes.length === 0) {
      const estado = await tx.unaFila<{ plan_id: number }>(
        `select id as plan_id from capita_plan
          where hermano_id = $1 and ejercicio_anio = $2 and vigente`,
        [datos.hermano_id, ctx.anio],
      );
      if (!estado) {
        throw new ErrorDeNegocio(
          `${hermano.nombre_completo} todavía no tiene modalidad de cápita asignada para ` +
            `${ctx.anio}. Asígnasela antes de registrar el pago.`,
          'hermano_id',
        );
      }
    }

    const movimientoId = await insertarMovimiento(
      tx,
      {
        fecha: datos.fecha,
        tipo: 'ingreso',
        bolsa: datos.bolsa,
        conceptoId: concepto.id,
        montoCentavos: datos.monto,
        descripcion: datos.descripcion ?? `Cápita de ${hermano.nombre_completo}`,
        hermanoId: datos.hermano_id,
        archivoId,
      },
      usuarioId,
    );

    /* Aplicación del mes más antiguo hacia adelante. */
    let restante = datos.monto;
    const meses: string[] = [];

    for (const cargo of pendientes) {
      if (restante <= 0) break;
      const aplica = Math.min(restante, cargo.saldo_centavos);
      await aplicarACargo(tx, movimientoId, cargo.capita_cargo_id, aplica, usuarioId);
      restante -= aplica;
      meses.push(nombrePeriodoCorto(cargo.periodo.slice(0, 7)));
    }

    const aplicado = datos.monto - restante;

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'capita_pago_registrado',
      entidad: 'movimiento',
      entidadId: movimientoId,
      detalle: {
        hermano: hermano.nombre_completo,
        monto: formatoMXN(datos.monto),
        aplicado: formatoMXN(aplicado),
        saldo_a_favor: formatoMXN(restante),
        meses,
        con_comprobante: archivoId !== null,
      },
    });

    return { movimientoId, aplicado, sinAplicar: restante, meses };
  }, usuarioId);
}

/** Exención de un mes. Solo el Venerable Maestro. */
export async function exentarMes(ctx: Contexto, datos: DatosExencion): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  if (ctx.sesion.usuario.rol !== 'venerable_maestro') {
    throw new ErrorDeNegocio(
      'Las exenciones las autoriza el Venerable Maestro.',
      'monto',
    );
  }

  const cargo = await unaFila<{
    hermano_id: number;
    periodo: string;
    nombre_completo: string;
  }>(
    `select cc.hermano_id, cc.periodo, h.nombre_completo
       from capita_cargo cc
       join hermano h on h.id = cc.hermano_id
      where cc.id = $1 and cc.estado = 'vigente'`,
    [datos.capita_cargo_id],
  );
  if (!cargo) throw new ErrorDeNegocio('Ese mes de cápita ya no está vigente.');

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'capita_exencion');

    try {
      await condonarCargo(tx, datos.capita_cargo_id, datos.monto, datos.motivo, usuarioId);
    } catch (error) {
      comoErrorDeNegocio(error, 'monto');
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'capita_exencion',
      entidad: 'capita_cargo',
      entidadId: datos.capita_cargo_id,
      detalle: {
        hermano: cargo.nombre_completo,
        periodo: cargo.periodo.slice(0, 7),
        monto: formatoMXN(datos.monto),
        motivo: datos.motivo,
      },
    });
  }, usuarioId);
}

/**
 * Aplica el saldo a favor del hermano a sus meses pendientes, del más antiguo
 * hacia adelante y solo en ejercicios abiertos. Sirve para el sobrante que quedó
 * de un pago viejo y para arrastrar dinero al ejercicio siguiente.
 */
export async function aplicarSaldoAFavor(
  ctx: Omit<Contexto, 'anio'>,
  hermanoId: number,
): Promise<{ aplicado: number; meses: string[] }> {
  const usuarioId = ctx.sesion.usuario.id;

  const hermano = await unaFila<{ nombre_completo: string }>(
    'select nombre_completo from hermano where id = $1',
    [hermanoId],
  );
  if (!hermano) throw new ErrorDeNegocio('Ese hermano no está en el padrón.');

  const disponible = await saldoAFavorDisponible(hermanoId);
  if (disponible <= 0) {
    throw new ErrorDeNegocio('Este hermano no tiene saldo a favor disponible.');
  }

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'capita_saldo_aplicar');

    const pagos = await pagosConRestante(tx, hermanoId);
    const cargos = await cargosConSaldoAbiertos(tx, hermanoId);
    if (cargos.length === 0) {
      throw new ErrorDeNegocio(
        'No hay meses pendientes en ejercicios abiertos a los que aplicar el saldo. ' +
          'Si el sobrante es para el año siguiente, primero abre ese ejercicio y ' +
          'asigna la modalidad.',
      );
    }

    /*
     * Tope global: el disponible ya descuenta devoluciones, que no están atadas
     * a un pago concreto. Por eso no basta el restante de cada pago.
     */
    let porAplicar = disponible;
    const meses: string[] = [];
    let indicePago = 0;
    let restantePago = pagos[0]?.restante ?? 0;

    for (const cargo of cargos) {
      let faltaCargo = cargo.saldo_centavos;
      while (faltaCargo > 0 && porAplicar > 0 && indicePago < pagos.length) {
        if (restantePago <= 0) {
          indicePago += 1;
          restantePago = pagos[indicePago]?.restante ?? 0;
          continue;
        }
        const monto = Math.min(faltaCargo, restantePago, porAplicar);
        await aplicarACargo(
          tx,
          pagos[indicePago]!.movimiento_id,
          cargo.capita_cargo_id,
          monto,
          usuarioId,
        );
        faltaCargo -= monto;
        restantePago -= monto;
        porAplicar -= monto;
      }
      if (faltaCargo < cargo.saldo_centavos) {
        meses.push(nombrePeriodoCorto(cargo.periodo.slice(0, 7)));
      }
      if (porAplicar <= 0) break;
    }

    const aplicado = disponible - porAplicar;
    if (aplicado <= 0) {
      throw new ErrorDeNegocio('No se pudo aplicar nada: revisa los meses pendientes.');
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'capita_saldo_aplicado',
      entidad: 'hermano',
      entidadId: hermanoId,
      detalle: {
        hermano: hermano.nombre_completo,
        aplicado: formatoMXN(aplicado),
        meses,
      },
    });

    return { aplicado, meses };
  }, usuarioId);
}

/**
 * Devuelve el saldo a favor como un egreso normal: pasa por las dos firmas y por
 * la entrega con comprobante, como cualquier salida de dinero de la caja.
 */
export async function devolverSaldoAFavor(
  ctx: Omit<Contexto, 'anio'>,
  hermanoId: number,
  montoCentavos: number,
): Promise<{ egresoId: number; folio: string }> {
  const usuarioId = ctx.sesion.usuario.id;

  const hermano = await unaFila<{ nombre_completo: string }>(
    'select nombre_completo from hermano where id = $1',
    [hermanoId],
  );
  if (!hermano) throw new ErrorDeNegocio('Ese hermano no está en el padrón.');

  const disponible = await saldoAFavorDisponible(hermanoId);
  if (montoCentavos > disponible) {
    throw new ErrorDeNegocio(
      `La devolución (${formatoMXN(montoCentavos)}) pasa del saldo a favor disponible ` +
        `(${formatoMXN(disponible)}).`,
      'monto',
    );
  }

  const concepto = await conceptoPorClave('devolucion_saldo_favor');
  if (!concepto) {
    throw new Error(
      'Falta el concepto "devolucion_saldo_favor" en el catálogo, revisa las migraciones.',
    );
  }

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'capita_saldo_devolver');

    const creado = await insertarEgreso(
      tx,
      {
        fecha_solicitud: hoyISO(),
        concepto_id: concepto.id,
        beneficiario: hermano.nombre_completo,
        descripcion: `Devolución de saldo a favor de cápita de ${hermano.nombre_completo}`,
        hermano_id: hermanoId,
        monto_solicitado_centavos: montoCentavos,
        requiere_comprobacion: false,
        notas: undefined,
      },
      usuarioId,
    );

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'capita_saldo_devolucion_solicitada',
      entidad: 'egreso',
      entidadId: creado.id,
      detalle: {
        folio: creado.folio,
        hermano: hermano.nombre_completo,
        monto: formatoMXN(montoCentavos),
      },
    });

    return { egresoId: creado.id, folio: creado.folio };
  }, usuarioId);
}

/** Quita una exención. Solo el Venerable Maestro, y queda en la bitácora. */
export async function quitarExencion(
  ctx: Omit<Contexto, 'anio'>,
  capitaCargoId: number,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  if (ctx.sesion.usuario.rol !== 'venerable_maestro') {
    throw new ErrorDeNegocio('Las exenciones las administra el Venerable Maestro.');
  }

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'capita_exencion_quitar');

    const quitada = await tx.unaFila<{ monto_centavos: number; motivo: string }>(
      `delete from capita_condonacion where capita_cargo_id = $1
       returning monto_centavos, motivo`,
      [capitaCargoId],
    );
    if (!quitada) throw new ErrorDeNegocio('Ese mes no tiene exención.');

    const cargo = await tx.laFila<{ periodo: string; nombre_completo: string }>(
      `select cc.periodo::text, h.nombre_completo
         from capita_cargo cc join hermano h on h.id = cc.hermano_id
        where cc.id = $1`,
      [capitaCargoId],
    );

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'capita_exencion_quitada',
      entidad: 'capita_cargo',
      entidadId: capitaCargoId,
      detalle: {
        hermano: cargo.nombre_completo,
        periodo: cargo.periodo.slice(0, 7),
        monto: formatoMXN(quitada.monto_centavos),
        motivo_original: quitada.motivo,
      },
    });
  }, usuarioId);
}
