/*
 * Estado general de la tesorería: una foto completa al momento de consultarla.
 * Reúne caja, cápitas, Gran Tesorería, cuotas de grado, egresos pendientes,
 * saldos a favor y evidencias faltantes. Lo usan la página, la hoja impresa y
 * el CSV, para que los tres digan exactamente lo mismo.
 *
 * Es de uso interno de la tesorería: lleva nombres de hermanos con adeudo, a
 * diferencia del informe de tenida, que solo da cifras.
 */
import { consulta } from '../db';
import { estadosDeCuenta, resumenCapitas, textoSituacion, NOMBRE_MODALIDAD } from './capitas';
import { bolsasAlDia, controlBolsas } from './cortes';
import { cuotasPorCobrar, NOMBRE_EVENTO_CUOTA, type CuotaGrado } from './cuotas';
import { listarEgresos, pendientesDeComprobar, type EgresoFila, type PendienteComprobar } from './egresos';
import { describirObligacion, estadoAplomo, type EstadoAplomo, type ObligacionFila } from './gt';
import { saldoDeCaja } from './movimientos';
import { pendientesDeEvidencia, type PendienteEvidencia } from './pendientes';
import { formatoMXN } from '../dinero';

export interface AdeudoHermano {
  hermano_id: number;
  nombre: string;
  modalidad: string;
  situacion: string;
  vencido_centavos: number;
  por_vencer_centavos: number;
}

/** Cómo va cada hermano con sus cápitas del ejercicio, deba o no. */
export interface CapitaHermano {
  hermano_id: number;
  nombre: string;
  baja: boolean;
  modalidad: string;
  situacion: string;
  al_corriente: boolean;
  esperado_centavos: number;
  pagado_centavos: number;
  vencido_centavos: number;
  por_vencer_centavos: number;
  saldo_a_favor_centavos: number;
}

export interface EstadoGeneral {
  anio: number;
  caja: {
    saldo: number;
    banco: number;
    efectivo: number;
    /** false mientras falte el arqueo inicial: banco y efectivo no se informan. */
    conBolsas: boolean;
  };
  capitas: {
    esperado: number;
    pagado: number;
    condonado: number;
    vencido: number;
    porVencer: number;
    alCorriente: number;
    adeudos: AdeudoHermano[];
    /** Todos los hermanos con plan en el ejercicio, primero los que deben. */
    hermanos: CapitaHermano[];
  };
  saldosAFavor: { hermano_id: number; nombre: string; saldo_centavos: number }[];
  gt: {
    aplomo: EstadoAplomo;
    pendientes: (ObligacionFila & { descripcion: string })[];
    totalPendiente: number;
  };
  cuotas: CuotaGrado[];
  totalCuotas: number;
  egresos: {
    porFirmar: EgresoFila[];
    porEntregar: EgresoFila[];
    porComprobar: PendienteComprobar[];
  };
  evidencias: PendienteEvidencia[];
}

/* Obligaciones con la Gran Tesorería que tienen saldo, de cualquier año. */
export const obligacionesConSaldo = (): Promise<ObligacionFila[]> =>
  consulta<ObligacionFila>(
    `select * from (
       select o.id, o.folio, o.tipo, o.periodo_desde::text, o.periodo_hasta::text,
              o.fecha_documento::text, o.monto_reportado_centavos, o.monto_esperado_centavos,
              o.estatus, o.hermano_id, h.nombre_completo as hermano_nombre, o.membresia_id,
              o.documento_calculo_id, o.motivo_cancelacion, o.observaciones,
              o.tramite_clase, o.tramite_descripcion,
              coalesce((select sum(a.monto_centavos)::int from gt_pago_aplicacion a
                         where a.obligacion_id = o.id), 0) as pagado_centavos,
              (o.monto_reportado_centavos
                - coalesce((select sum(a.monto_centavos)::int from gt_pago_aplicacion a
                             where a.obligacion_id = o.id), 0)) as saldo_centavos
         from gt_obligacion o
         left join hermano h on h.id = o.hermano_id
        where o.estatus in ('pendiente_pago', 'parcialmente_pagada')
     ) x
     where saldo_centavos > 0
     order by periodo_desde, id`,
  );

export async function estadoGeneral(anio: number): Promise<EstadoGeneral> {
  const [caja, control, resumen, estados, aplomo, obligaciones, cuotas, pendientes, porComprobar, evidencias] =
    await Promise.all([
      saldoDeCaja(anio),
      controlBolsas(anio),
      resumenCapitas(anio),
      estadosDeCuenta(anio),
      estadoAplomo(),
      obligacionesConSaldo(),
      cuotasPorCobrar(),
      listarEgresos({ anio, pendientes: true }),
      pendientesDeComprobar(),
      pendientesDeEvidencia(),
    ]);

  const adeudos = estados
    .filter((e) => e.vencido_centavos > 0)
    .sort((a, b) => b.vencido_centavos - a.vencido_centavos || a.nombre_completo.localeCompare(b.nombre_completo))
    .map((e) => ({
      hermano_id: e.hermano_id,
      nombre: e.nombre_completo,
      modalidad: e.modalidad ? NOMBRE_MODALIDAD[e.modalidad] : 'Sin modalidad',
      situacion: textoSituacion(e.modalidad, e.meses_vencidos),
      vencido_centavos: e.vencido_centavos,
      por_vencer_centavos: e.por_vencer_centavos,
    }));

  const hermanos = estados.map((e) => ({
    hermano_id: e.hermano_id,
    nombre: e.nombre_completo,
    baja: e.estatus === 'baja',
    modalidad: e.modalidad ? NOMBRE_MODALIDAD[e.modalidad] : 'Sin modalidad',
    situacion: e.vencido_centavos > 0 ? textoSituacion(e.modalidad, e.meses_vencidos) : 'Al corriente',
    al_corriente: e.vencido_centavos === 0,
    esperado_centavos: e.esperado_centavos,
    pagado_centavos: e.pagado_centavos,
    vencido_centavos: e.vencido_centavos,
    por_vencer_centavos: e.por_vencer_centavos,
    saldo_a_favor_centavos: e.saldo_a_favor_centavos,
  }));

  const saldosAFavor = estados
    .filter((e) => e.saldo_a_favor_centavos > 0)
    .map((e) => ({
      hermano_id: e.hermano_id,
      nombre: e.nombre_completo,
      saldo_centavos: e.saldo_a_favor_centavos,
    }));

  const gtPendientes = obligaciones.map((o) => ({ ...o, descripcion: describirObligacion(o) }));

  return {
    anio,
    caja: {
      saldo: caja.saldo,
      banco: caja.banco,
      efectivo: caja.efectivo,
      conBolsas: bolsasAlDia(control),
    },
    capitas: {
      esperado: resumen?.esperado ?? 0,
      pagado: resumen?.pagado ?? 0,
      condonado: resumen?.condonado ?? 0,
      vencido: resumen?.vencido ?? 0,
      porVencer: resumen?.por_vencer ?? 0,
      alCorriente: resumen?.al_corriente ?? 0,
      adeudos,
      hermanos,
    },
    saldosAFavor,
    gt: {
      aplomo,
      pendientes: gtPendientes,
      totalPendiente: gtPendientes.reduce((s, o) => s + o.saldo_centavos, 0),
    },
    cuotas,
    totalCuotas: cuotas.reduce((s, c) => s + c.saldo_centavos, 0),
    egresos: {
      porFirmar: pendientes.filter((e) => e.estado === 'registrado'),
      porEntregar: pendientes.filter((e) => e.estado === 'autorizado'),
      porComprobar,
    },
    evidencias,
  };
}

/* El CSV va en pesos con dos decimales y sin signo, que Excel lee como número. */
const pesos = (centavos: number | null): string =>
  centavos == null ? '' : (centavos / 100).toFixed(2);

/**
 * El estado general como filas de un solo CSV. Excel no admite varias hojas en
 * un CSV, así que la primera columna dice a qué sección pertenece cada fila y
 * se puede filtrar por ella.
 */
export function filasCSV(e: EstadoGeneral): { encabezados: string[]; filas: (string | number | null)[][] } {
  const filas: (string | number | null)[][] = [];
  const fila = (seccion: string, concepto: string, persona: string | null, detalle: string | null, monto: number | null) =>
    filas.push([seccion, concepto, persona, detalle, pesos(monto)]);

  fila('Caja', 'Total en caja', null, null, e.caja.saldo);
  if (e.caja.conBolsas) {
    fila('Caja', 'En banco', null, null, e.caja.banco);
    fila('Caja', 'En efectivo', null, null, e.caja.efectivo);
  }

  fila('Cápitas', 'Esperado del ejercicio', null, null, e.capitas.esperado);
  fila('Cápitas', 'Cobrado', null, null, e.capitas.pagado);
  if (e.capitas.condonado > 0) fila('Cápitas', 'Exento', null, null, e.capitas.condonado);
  fila('Cápitas', 'Vencido', null, `${e.capitas.adeudos.length} ${e.capitas.adeudos.length === 1 ? 'hermano' : 'hermanos'} con adeudo`, e.capitas.vencido);
  fila('Cápitas', 'Por vencer en el año', null, null, e.capitas.porVencer);
  for (const h of e.capitas.hermanos) {
    fila('Cápitas por hermano', h.situacion, h.nombre, `${h.modalidad}. Pagado ${pesos(h.pagado_centavos)}, por vencer ${pesos(h.por_vencer_centavos)}`, h.vencido_centavos);
  }

  for (const s of e.saldosAFavor) {
    fila('Saldo a favor', 'Saldo a favor de cápita', s.nombre, null, s.saldo_centavos);
  }

  fila(
    'Gran Tesorería',
    e.gt.aplomo.ordinario_a_plomo ? 'A plomo en lo ordinario' : 'Con obligaciones ordinarias pendientes',
    null,
    e.gt.aplomo.cubierto_hasta ? `Cubierta hasta ${e.gt.aplomo.cubierto_hasta.slice(0, 7)}` : null,
    e.gt.totalPendiente,
  );
  for (const o of e.gt.pendientes) {
    fila('Obligación con la Gran Tesorería', `${o.folio} ${o.descripcion}`, o.hermano_nombre, null, o.saldo_centavos);
  }

  for (const c of e.cuotas) {
    fila('Cuota de grado por cobrar', NOMBRE_EVENTO_CUOTA[c.tipo_evento], c.nombre_completo, c.fecha, c.saldo_centavos);
  }

  for (const g of e.egresos.porFirmar) {
    fila('Egreso por firmar', `${g.folio} ${g.concepto_nombre}`, g.beneficiario, g.descripcion, g.monto_solicitado_centavos);
  }
  for (const g of e.egresos.porEntregar) {
    fila('Egreso por entregar', `${g.folio} ${g.concepto_nombre}`, g.beneficiario, g.descripcion, g.monto_autorizado_centavos ?? g.monto_solicitado_centavos);
  }
  for (const p of e.egresos.porComprobar) {
    fila('Egreso por comprobar', `${p.folio} ${p.concepto_nombre}`, p.beneficiario, `Entregado el ${p.fecha_entrega}`, p.pendiente_centavos);
  }

  for (const v of e.evidencias) {
    fila('Evidencia faltante', v.titulo, null, v.detalle, v.monto_centavos);
  }

  return { encabezados: ['Sección', 'Concepto', 'Persona', 'Detalle', 'Monto'], filas };
}

/** Totales a la vista, para el encabezado de la página y de la hoja. */
export const resumenEnPalabras = (e: EstadoGeneral): string =>
  `Caja ${formatoMXN(e.caja.saldo)}; cápitas vencidas ${formatoMXN(e.capitas.vencido)} de ` +
  `${e.capitas.adeudos.length} ${e.capitas.adeudos.length === 1 ? 'hermano' : 'hermanos'}; ` +
  `por pagar a la Gran Tesorería ${formatoMXN(e.gt.totalPendiente)}; cuotas de grado por ` +
  `cobrar ${formatoMXN(e.totalCuotas)}.`;
