/*
 * Cierre y reapertura de cortes, y los movimientos de ajuste.
 *
 * El camino normal para corregir un mes ya cerrado es un movimiento de ajuste en
 * el mes abierto, no reabrir el corte: los cortes ya se leyeron en tenida y
 * reescribir el pasado destruye la confianza en los números. La reapertura existe
 * para lo excepcional, la autoriza el Venerable Maestro y deja huella permanente.
 */
import { esNivelVM } from '../tipos';
import { registrarEn } from '../bitacora';
import { consumirNonce } from '../csrf';
import { enTransaccion, unaFila } from '../db';
import { conceptoPorClave } from '../datos/conceptos';
import { cerrarCorteEnBase, reabrirCorteEnBase } from '../datos/cortes';
import { insertarMovimiento, ligarAjuste, obtenerMovimiento } from '../datos/movimientos';
import { formatoMXN } from '../dinero';
import { ErrorDeNegocio } from '../errores';
import { nombrePeriodo, periodoDe } from '../fechas';
import type { Sesion } from '../sesion';

interface Contexto {
  sesion: Sesion;
  nonce: string;
  idPeticion: string;
}

const esVM = (s: Sesion): boolean => esNivelVM(s.usuario.rol);

/** Los mensajes de la base ya vienen en español y pensados para el tesorero. */
function comoErrorDeNegocio(error: unknown, campo?: string): never {
  const e = error as { code?: string; message?: string };
  if (e.code === 'P0001') throw new ErrorDeNegocio(e.message ?? 'No se pudo completar.', campo);
  throw error;
}

export async function cerrarCorte(
  ctx: Contexto,
  periodo: string,
  observaciones: string | undefined,
): Promise<number> {
  const usuarioId = ctx.sesion.usuario.id;

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'corte_cerrar');

    let corteId: number;
    try {
      corteId = await cerrarCorteEnBase(tx, periodo, observaciones ?? null);
    } catch (error) {
      comoErrorDeNegocio(error);
    }

    const guardado = await tx.laFila<{
      saldo_final_centavos: number;
      total_ingresos_centavos: number;
      total_egresos_centavos: number;
    }>(
      `select saldo_final_centavos, total_ingresos_centavos, total_egresos_centavos
         from corte_mensual where id = $1`,
      [corteId],
    );

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'corte_cerrado',
      entidad: 'corte_mensual',
      entidadId: corteId,
      detalle: {
        periodo,
        ingresos: formatoMXN(guardado.total_ingresos_centavos),
        egresos: formatoMXN(guardado.total_egresos_centavos),
        saldo_final: formatoMXN(guardado.saldo_final_centavos),
        observaciones: observaciones ?? null,
      },
    });

    return corteId;
  }, usuarioId);
}

export async function reabrirCorte(
  ctx: Contexto,
  corteId: number,
  motivo: string,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  if (!esVM(ctx.sesion)) {
    throw new ErrorDeNegocio(
      'La reapertura de un corte la autoriza el Venerable Maestro. Lo normal es ' +
        'corregir con un movimiento de ajuste en el mes abierto.',
      'motivo',
    );
  }

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'corte_reabrir');

    try {
      await reabrirCorteEnBase(tx, corteId, motivo, usuarioId);
    } catch (error) {
      comoErrorDeNegocio(error, 'motivo');
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'corte_reabierto',
      entidad: 'corte_mensual',
      entidadId: corteId,
      detalle: { motivo },
    });
  }, usuarioId);
}

/**
 * Movimiento de ajuste: uno de signo contrario en el mes abierto, ligado al que
 * corrige. El libro no se reescribe, se explica.
 */
export async function registrarAjuste(
  ctx: Contexto,
  movimientoOrigenId: number,
  datos: { fecha: string; monto: number; motivo: string },
): Promise<number> {
  const usuarioId = ctx.sesion.usuario.id;

  if (!esVM(ctx.sesion)) {
    throw new ErrorDeNegocio(
      'Los ajustes sobre un mes cerrado los autoriza el Venerable Maestro.',
      'motivo',
    );
  }

  const origen = await obtenerMovimiento(movimientoOrigenId);
  if (!origen) throw new ErrorDeNegocio('Ese movimiento ya no existe.');
  if (origen.es_ajuste) {
    throw new ErrorDeNegocio(
      'Ese movimiento ya es un ajuste. Corrige el original, no el ajuste.',
    );
  }
  if (datos.monto > origen.monto_centavos) {
    throw new ErrorDeNegocio(
      `El ajuste (${formatoMXN(datos.monto)}) no puede pasar del movimiento original ` +
        `(${formatoMXN(origen.monto_centavos)}).`,
      'monto',
    );
  }

  const cerrado = await unaFila<{ estado: string }>(
    `select estado from corte_mensual where periodo = $1`,
    [`${periodoDe(datos.fecha)}-01`],
  );
  if (cerrado?.estado === 'cerrado') {
    throw new ErrorDeNegocio(
      `El ajuste tiene que caer en un mes abierto, y ${nombrePeriodo(periodoDe(datos.fecha))} ` +
        'ya está cerrado.',
      'fecha',
    );
  }

  /*
   * El ajuste va en sentido contrario, así que lleva su propio concepto: el del
   * movimiento original es de la naturaleza opuesta y además conviene que en el
   * corte los ajustes se lean aparte.
   */
  const claveConcepto = origen.tipo === 'ingreso' ? 'ajuste_ingreso' : 'ajuste_egreso';
  const conceptoAjuste = await conceptoPorClave(claveConcepto);
  if (!conceptoAjuste) {
    throw new Error(
      `Falta el concepto "${claveConcepto}" en el catálogo, revisa las migraciones.`,
    );
  }

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'movimiento_ajuste');

    /* Signo contrario al original: si aquello fue un egreso, esto es un ingreso. */
    const ajusteId = await insertarMovimiento(
      tx,
      {
        fecha: datos.fecha,
        tipo: origen.tipo === 'ingreso' ? 'egreso' : 'ingreso',
        /* El ajuste deshace dinero de la misma bolsa donde se registró mal. */
        bolsa: origen.bolsa,
        conceptoId: conceptoAjuste.id,
        montoCentavos: datos.monto,
        descripcion:
          `Ajuste del movimiento #${origen.id} del ${origen.fecha}: ${datos.motivo}`,
        hermanoId: origen.hermano_id,
      },
      usuarioId,
    );

    await ligarAjuste(tx, ajusteId, origen.id, datos.motivo, usuarioId, usuarioId);

    /*
     * Si lo corregido es un pago de cápita, los meses que ese dinero cubría se
     * liberan por el mismo monto, del mes más reciente hacia atrás. Sin esto, el
     * hermano quedaría con meses cubiertos por dinero que ya se reconoció como
     * mal capturado.
     */
    if (origen.tipo === 'ingreso' && origen.tipo_especial === 'capita') {
      const aplicaciones = await tx.consulta<{
        id: number;
        monto_aplicado_centavos: number;
        periodo: string;
      }>(
        `select ca.id, ca.monto_aplicado_centavos, cc.periodo::text
           from capita_aplicacion ca
           join capita_cargo cc on cc.id = ca.capita_cargo_id
          where ca.movimiento_id = $1
          order by cc.periodo desc, ca.id desc`,
        [origen.id],
      );

      let porLiberar = datos.monto;
      for (const aplicacion of aplicaciones) {
        if (porLiberar <= 0) break;
        if (aplicacion.monto_aplicado_centavos <= porLiberar) {
          await tx.consulta('delete from capita_aplicacion where id = $1', [aplicacion.id]);
          porLiberar -= aplicacion.monto_aplicado_centavos;
        } else {
          await tx.consulta(
            'update capita_aplicacion set monto_aplicado_centavos = monto_aplicado_centavos - $2 where id = $1',
            [aplicacion.id, porLiberar],
          );
          porLiberar = 0;
        }
      }
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'movimiento_ajustado',
      entidad: 'movimiento',
      entidadId: ajusteId,
      detalle: {
        origen: origen.id,
        origen_fecha: origen.fecha,
        monto: formatoMXN(datos.monto),
        motivo: datos.motivo,
      },
    });

    return ajusteId;
  }, usuarioId);
}
