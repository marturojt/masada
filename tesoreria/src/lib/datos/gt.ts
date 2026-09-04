/*
 * Dominio de la Gran Tesorería: membresías (fotografías documentales), tarifas
 * versionadas, obligaciones con su desglose, pagos y aplicaciones.
 *
 * Regla del dominio: el cálculo interno (membresía por tarifas) es para
 * conciliar; el monto exigible es siempre el que reporta la Gran Tesorería.
 */
import { consulta, unaFila, type Tx } from '../db';
import type { Bolsa } from '../tipos';

export type ConceptoGT = 'capita' | 'templo' | 'locker' | 'otro';
export type TipoObligacion = 'ordinaria' | 'regularizacion' | 'tramite' | 'extraordinaria';
export type EstatusObligacion =
  | 'pendiente_pago'
  | 'parcialmente_pagada'
  | 'pagada'
  | 'cancelada';

export const NOMBRE_CONCEPTO_GT: Record<ConceptoGT, string> = {
  capita: 'Cápita',
  templo: 'Templo',
  locker: 'Locker',
  otro: 'Otro',
};

export type ClaseTramite =
  | 'iniciacion'
  | 'afiliacion'
  | 'aumento_salario'
  | 'exaltacion'
  | 'otro';

export const NOMBRE_CLASE_TRAMITE: Record<ClaseTramite, string> = {
  iniciacion: 'Iniciación (da el grado de aprendiz)',
  afiliacion: 'Afiliación',
  aumento_salario: 'Aumento de salario (da el grado de compañero)',
  exaltacion: 'Exaltación (da el grado de maestro)',
  otro: 'Otro trámite administrativo',
};

export const NOMBRE_TIPO_OBLIGACION: Record<TipoObligacion, string> = {
  ordinaria: 'Ordinaria del mes',
  regularizacion: 'Regularización',
  tramite: 'Trámite (iniciación, afiliación, grado)',
  extraordinaria: 'Extraordinaria',
};

export const NOMBRE_ESTATUS_OBLIGACION: Record<EstatusObligacion, string> = {
  pendiente_pago: 'Pendiente de pago',
  parcialmente_pagada: 'Parcialmente pagada',
  pagada: 'Pagada',
  cancelada: 'Cancelada',
};

// ── Tarifas ──────────────────────────────────────────────────────────────────

export interface TarifaGT {
  concepto: ConceptoGT;
  descripcion: string | null;
  monto_centavos: number;
  vigencia_desde: string;
  vigencia_hasta: string | null;
}

export const tarifasGTVigentes = (): Promise<TarifaGT[]> =>
  consulta<TarifaGT>('select * from v_gt_tarifa_vigente');

export const historialTarifasGT = (): Promise<(TarifaGT & { id: number; creado_nombre: string | null })[]> =>
  consulta(
    `select t.id, t.concepto, t.descripcion, t.monto_centavos,
            t.vigencia_desde::text, t.vigencia_hasta::text, u.nombre as creado_nombre
       from gt_tarifa t
       left join usuario u on u.id = t.creado_por
      order by t.concepto, t.vigencia_desde desc, t.id desc`,
  );

export async function insertarTarifaGT(
  tx: Tx,
  datos: {
    concepto: ConceptoGT;
    descripcion?: string | undefined;
    montoCentavos: number;
    vigenciaDesde: string;
  },
  usuarioId: number,
): Promise<number> {
  const fila = await tx.laFila<{ id: number }>(
    `insert into gt_tarifa (concepto, descripcion, monto_centavos, vigencia_desde, creado_por)
     values ($1, $2, $3, $4, $5) returning id`,
    [datos.concepto, datos.descripcion ?? null, datos.montoCentavos, datos.vigenciaDesde, usuarioId],
  );
  return fila.id;
}

// ── Membresías ───────────────────────────────────────────────────────────────

export interface Membresia {
  id: number;
  fecha_documento: string;
  fecha_recepcion: string | null;
  periodo_referencia: string;
  archivo_id: number | null;
  observaciones: string | null;
  renglones: number;
  con_capita: number;
  sin_ligar: number;
}

export const listarMembresias = (): Promise<Membresia[]> =>
  consulta<Membresia>(
    `select m.id, m.fecha_documento::text, m.fecha_recepcion::text,
            m.periodo_referencia::text, m.archivo_id, m.observaciones,
            (select count(*)::int from gt_membresia_hermano r where r.membresia_id = m.id)
              as renglones,
            (select count(*)::int from gt_membresia_hermano r
              where r.membresia_id = m.id and r.genera_capita) as con_capita,
            (select count(*)::int from gt_membresia_hermano r
              where r.membresia_id = m.id and r.hermano_id is null) as sin_ligar
       from gt_membresia m
      order by m.periodo_referencia desc, m.id desc`,
  );

export const membresiaActual = (): Promise<Membresia | null> =>
  unaFila<Membresia>(
    `select id, periodo_referencia::text, fecha_documento::text,
            null::text as fecha_recepcion, archivo_id, null as observaciones,
            renglones, con_capita, sin_ligar
       from v_gt_membresia_actual`,
  );

export const obtenerMembresia = (id: number): Promise<Membresia | null> =>
  unaFila<Membresia>(
    `select m.id, m.fecha_documento::text, m.fecha_recepcion::text,
            m.periodo_referencia::text, m.archivo_id, m.observaciones,
            (select count(*)::int from gt_membresia_hermano r where r.membresia_id = m.id)
              as renglones,
            (select count(*)::int from gt_membresia_hermano r
              where r.membresia_id = m.id and r.genera_capita) as con_capita,
            (select count(*)::int from gt_membresia_hermano r
              where r.membresia_id = m.id and r.hermano_id is null) as sin_ligar
       from gt_membresia m where m.id = $1`,
    [id],
  );

export interface RenglonMembresia {
  id: number;
  hermano_id: number | null;
  hermano_nombre: string | null;
  nombre_reportado: string;
  clave_mason_reportada: string | null;
  grado_reportado: string | null;
  estatus_reportado: string | null;
  genera_capita: boolean;
  conciliado: boolean;
  observaciones: string | null;
}

export const renglonesDeMembresia = (membresiaId: number): Promise<RenglonMembresia[]> =>
  consulta<RenglonMembresia>(
    `select r.id, r.hermano_id, h.nombre_completo as hermano_nombre,
            r.nombre_reportado, r.clave_mason_reportada, r.grado_reportado,
            r.estatus_reportado, r.genera_capita, r.conciliado, r.observaciones
       from gt_membresia_hermano r
       left join hermano h on h.id = r.hermano_id
      where r.membresia_id = $1
      order by r.nombre_reportado`,
    [membresiaId],
  );

// ── Obligaciones ─────────────────────────────────────────────────────────────

export interface ObligacionFila {
  id: number;
  folio: string;
  tipo: TipoObligacion;
  periodo_desde: string;
  periodo_hasta: string;
  fecha_documento: string;
  monto_reportado_centavos: number;
  monto_esperado_centavos: number | null;
  estatus: EstatusObligacion;
  hermano_id: number | null;
  hermano_nombre: string | null;
  membresia_id: number | null;
  documento_calculo_id: number | null;
  motivo_cancelacion: string | null;
  observaciones: string | null;
  tramite_clase: ClaseTramite | null;
  tramite_descripcion: string | null;
  pagado_centavos: number;
  saldo_centavos: number;
}

const COLS_OBL = `o.id, o.folio, o.tipo, o.periodo_desde::text, o.periodo_hasta::text,
       o.fecha_documento::text, o.monto_reportado_centavos, o.monto_esperado_centavos,
       o.estatus, o.hermano_id, h.nombre_completo as hermano_nombre, o.membresia_id,
       o.documento_calculo_id, o.motivo_cancelacion, o.observaciones,
       o.tramite_clase, o.tramite_descripcion,
       coalesce((select sum(a.monto_centavos)::int from gt_pago_aplicacion a
                  where a.obligacion_id = o.id), 0) as pagado_centavos,
       (o.monto_reportado_centavos
         - coalesce((select sum(a.monto_centavos)::int from gt_pago_aplicacion a
                      where a.obligacion_id = o.id), 0)) as saldo_centavos`;

export const listarObligaciones = (anio: number): Promise<ObligacionFila[]> =>
  consulta<ObligacionFila>(
    `select ${COLS_OBL}
       from gt_obligacion o
       left join hermano h on h.id = o.hermano_id
      where extract(year from o.periodo_desde)::int = $1
         or extract(year from o.periodo_hasta)::int = $1
      order by o.periodo_desde desc, o.id desc`,
    [anio],
  );

export const obtenerObligacion = (id: number): Promise<ObligacionFila | null> =>
  unaFila<ObligacionFila>(
    `select ${COLS_OBL}
       from gt_obligacion o
       left join hermano h on h.id = o.hermano_id
      where o.id = $1`,
    [id],
  );

export interface DetalleObligacion {
  id: number;
  concepto: string;
  cantidad: number;
  tarifa_centavos: number | null;
  subtotal_centavos: number;
  hermano_id: number | null;
  hermano_nombre: string | null;
  periodo: string | null;
  descripcion: string | null;
}

export const detalleDeObligacion = (obligacionId: number): Promise<DetalleObligacion[]> =>
  consulta<DetalleObligacion>(
    `select d.id, d.concepto, d.cantidad, d.tarifa_centavos, d.subtotal_centavos,
            d.hermano_id, h.nombre_completo as hermano_nombre, d.periodo::text,
            d.descripcion
       from gt_obligacion_detalle d
       left join hermano h on h.id = d.hermano_id
      where d.obligacion_id = $1
      order by d.id`,
    [obligacionId],
  );

// ── Pagos ────────────────────────────────────────────────────────────────────

export interface PagoGT {
  id: number;
  folio: string;
  fecha_pago: string;
  monto_centavos: number;
  bolsa: Bolsa;
  medio_pago: string | null;
  referencia: string | null;
  recibo_gt_id: number | null;
  movimiento_id: number;
  egreso_id: number | null;
  egreso_folio: string | null;
  obligaciones: string | null;
}

export const listarPagosGT = (anio: number): Promise<PagoGT[]> =>
  consulta<PagoGT>(
    `select p.id, p.folio, p.fecha_pago::text, p.monto_centavos, p.bolsa, p.medio_pago,
            p.referencia, p.recibo_gt_id, p.movimiento_id,
            m.egreso_id, e.folio as egreso_folio,
            (select string_agg(o.folio, ', ' order by o.folio)
               from gt_pago_aplicacion a
               join gt_obligacion o on o.id = a.obligacion_id
              where a.pago_id = p.id) as obligaciones
       from gt_pago p
       join movimiento m on m.id = p.movimiento_id
       left join egreso e on e.id = m.egreso_id
      where extract(year from p.fecha_pago)::int = $1
      order by p.fecha_pago desc, p.id desc`,
    [anio],
  );

export const aplicacionesDeObligacion = (
  obligacionId: number,
): Promise<{ pago_folio: string; fecha_pago: string; monto_centavos: number }[]> =>
  consulta(
    `select p.folio as pago_folio, p.fecha_pago::text, a.monto_centavos
       from gt_pago_aplicacion a
       join gt_pago p on p.id = a.pago_id
      where a.obligacion_id = $1
      order by p.fecha_pago, p.id`,
    [obligacionId],
  );

// ── Vistas de estado ─────────────────────────────────────────────────────────

export interface EstadoAplomo {
  cubierto_hasta: string | null;
  primer_pendiente: string | null;
  meses_pendientes: number;
  ordinario_a_plomo: boolean;
  regularizaciones_pendientes: number;
  otras_pendientes: number;
}

export const estadoAplomo = (): Promise<EstadoAplomo> =>
  unaFila<EstadoAplomo>('select * from v_gt_estado_aplomo').then(
    (f) =>
      f ?? {
        cubierto_hasta: null,
        primer_pendiente: null,
        meses_pendientes: 0,
        ordinario_a_plomo: true,
        regularizaciones_pendientes: 0,
        otras_pendientes: 0,
      },
  );

export interface CalculoEsperado {
  concepto: ConceptoGT;
  descripcion: string | null;
  cantidad: number;
  tarifa_centavos: number;
  subtotal_centavos: number;
}

export const calculoEsperado = (): Promise<CalculoEsperado[]> =>
  consulta<CalculoEsperado>('select * from v_gt_calculo_esperado');

export const periodosCubiertos = (
  anio: number,
): Promise<{ periodo: string; cubierto: boolean; pagado_centavos: number }[]> =>
  consulta(
    `select periodo::text, cubierto, pagado_centavos
       from v_gt_periodos_cubiertos where anio = $1 order by periodo`,
    [anio],
  );

export interface ExposicionRegularizacion {
  hermano_id: number;
  nombre_completo: string;
  estatus_gt: string;
  desde: string;
  meses_potenciales: number;
}

export const exposicionRegularizacion = (): Promise<ExposicionRegularizacion[]> =>
  consulta<ExposicionRegularizacion>(
    'select hermano_id, nombre_completo, estatus_gt, desde::text, meses_potenciales from v_gt_exposicion_regularizacion',
  );

export const obligacionesLigadasAEgreso = (
  tx: Tx,
  egresoId: number,
): Promise<{ obligacion_id: number; monto_centavos: number; folio: string }[]> =>
  tx.consulta(
    `select l.obligacion_id, l.monto_centavos, o.folio
       from egreso_gt_obligacion l
       join gt_obligacion o on o.id = l.obligacion_id
      where l.egreso_id = $1
      order by o.periodo_desde`,
    [egresoId],
  );

export const obligacionesDeEgreso = (
  egresoId: number,
): Promise<{ obligacion_id: number; monto_centavos: number; folio: string; tipo: string }[]> =>
  consulta(
    `select l.obligacion_id, l.monto_centavos, o.folio, o.tipo
       from egreso_gt_obligacion l
       join gt_obligacion o on o.id = l.obligacion_id
      where l.egreso_id = $1
      order by o.periodo_desde`,
    [egresoId],
  );

// ── Conciliación de padrones ─────────────────────────────────────────────────

export type EstadoConciliacion =
  | 'conciliado'
  | 'pendiente_gt'
  | 'pendiente_formalizacion'
  | 'inconsistencia'
  | 'sin_diferencias';

export const NOMBRE_ESTADO_CONCILIACION: Record<EstadoConciliacion, string> = {
  conciliado: 'Conciliado',
  pendiente_gt: 'Pendiente ante GT',
  pendiente_formalizacion: 'Pendiente de formalizar',
  inconsistencia: 'Inconsistencia',
  sin_diferencias: 'Sin diferencias',
};

export interface ConciliacionPadron {
  hermano_id: number;
  nombre_completo: string;
  interno: boolean;
  estatus_gs: string;
  estatus_gt: string;
  en_gran_secretaria: boolean;
  en_gran_tesoreria: boolean;
  estado: EstadoConciliacion;
  gs_fecha_registro: string | null;
  gt_fecha_registro: string | null;
  gs_observaciones: string | null;
  gt_observaciones: string | null;
}

export const conciliacionPadrones = (): Promise<ConciliacionPadron[]> =>
  consulta<ConciliacionPadron>(
    `select hermano_id, nombre_completo, interno, estatus_gs, estatus_gt,
            en_gran_secretaria, en_gran_tesoreria, estado,
            gs_fecha_registro::text, gt_fecha_registro::text,
            gs_observaciones, gt_observaciones
       from v_conciliacion_padrones`,
  );

export interface RegistroExterno {
  estatus: 'pendiente' | 'activo' | 'baja' | 'desconocido';
  fecha_registro: string | null;
  fecha_efectiva: string | null;
  fecha_baja: string | null;
  observaciones: string | null;
}

export const NOMBRE_ESTATUS_EXTERNO: Record<string, string> = {
  pendiente: 'Pendiente',
  activo: 'Activo',
  baja: 'Baja',
  desconocido: 'Desconocido',
};

/** Lo que cada organismo sabe de un hermano, para su ficha. */
export async function registrosExternosDe(
  hermanoId: number,
): Promise<{ gran_secretaria: RegistroExterno | null; gran_tesoreria: RegistroExterno | null }> {
  const [gs, gt] = await Promise.all([
    unaFila<RegistroExterno>(
      `select estatus, fecha_registro::text, fecha_efectiva::text, fecha_baja::text,
              observaciones
         from hermano_gran_secretaria where hermano_id = $1`,
      [hermanoId],
    ),
    unaFila<RegistroExterno>(
      `select estatus, fecha_registro::text, fecha_efectiva::text, fecha_baja::text,
              observaciones
         from hermano_gran_tesoreria where hermano_id = $1`,
      [hermanoId],
    ),
  ]);
  return { gran_secretaria: gs, gran_tesoreria: gt };
}
