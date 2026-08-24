/*
 * Cortes mensuales.
 */
import { consulta, unaFila, type Tx } from '../db';

export interface CorteCalculado {
  anio: number;
  periodo: string;
  total_ingresos_centavos: number;
  total_egresos_centavos: number;
  saldo_inicial_centavos: number;
  saldo_final_centavos: number;
  banco_inicial_centavos: number;
  banco_final_centavos: number;
  efectivo_inicial_centavos: number;
  efectivo_final_centavos: number;
  hay_traspasos: boolean;
  corte_id: number | null;
  estado_corte: 'abierto' | 'cerrado' | null;
  cerrado_en: string | null;
  cerrado_nombre: string | null;
  reaperturas: number | null;
}

export const cortesDelAnio = (anio: number): Promise<CorteCalculado[]> =>
  consulta<CorteCalculado>(
    'select * from v_corte_calculado where anio = $1 order by periodo',
    [anio],
  );

export const corteDelPeriodo = (periodo: string): Promise<CorteCalculado | null> =>
  unaFila<CorteCalculado>('select * from v_corte_calculado where periodo = $1', [
    `${periodo}-01`,
  ]);

export interface CorteGuardado {
  id: number;
  periodo: string;
  estado: 'abierto' | 'cerrado';
  saldo_inicial_centavos: number;
  total_ingresos_centavos: number;
  total_egresos_centavos: number;
  saldo_final_centavos: number;
  banco_inicial_centavos: number;
  banco_final_centavos: number;
  efectivo_inicial_centavos: number;
  efectivo_final_centavos: number;
  capitas_esperadas_centavos: number;
  capitas_cobradas_centavos: number;
  pendiente_comprobar_centavos: number;
  observaciones: string | null;
  cerrado_nombre: string | null;
  cerrado_en: string | null;
  reaperturas: number;
}

export const corteGuardado = (periodo: string): Promise<CorteGuardado | null> =>
  unaFila<CorteGuardado>(
    `select c.id, c.periodo, c.estado, c.saldo_inicial_centavos, c.total_ingresos_centavos,
            c.total_egresos_centavos, c.saldo_final_centavos,
            c.banco_inicial_centavos, c.banco_final_centavos,
            c.efectivo_inicial_centavos, c.efectivo_final_centavos,
            c.capitas_esperadas_centavos,
            c.capitas_cobradas_centavos, c.pendiente_comprobar_centavos, c.observaciones,
            u.nombre as cerrado_nombre, c.cerrado_en::text, c.reaperturas
       from corte_mensual c
       left join usuario u on u.id = c.cerrado_por
      where c.periodo = $1`,
    [`${periodo}-01`],
  );

export interface Reapertura {
  motivo: string;
  reabierto_nombre: string;
  reabierto_en: string;
}

export const reaperturasDe = (corteId: number): Promise<Reapertura[]> =>
  consulta<Reapertura>(
    `select r.motivo, u.nombre as reabierto_nombre, r.reabierto_en::text
       from corte_reapertura r
       join usuario u on u.id = r.reabierto_por
      where r.corte_id = $1
      order by r.reabierto_en desc`,
    [corteId],
  );

export async function cerrarCorteEnBase(
  tx: Tx,
  periodo: string,
  observaciones: string | null,
): Promise<number> {
  const fila = await tx.laFila<{ corte_id: number }>(
    'select fn_cerrar_corte($1, $2) as corte_id',
    [`${periodo}-01`, observaciones],
  );
  return fila.corte_id;
}

export async function reabrirCorteEnBase(
  tx: Tx,
  corteId: number,
  motivo: string,
  usuarioId: number,
): Promise<void> {
  await tx.consulta('select fn_reabrir_corte($1, $2, $3)', [corteId, motivo, usuarioId]);
}

/** El mes abierto más antiguo del ejercicio, que es donde toca capturar. */
export const primerMesAbierto = async (anio: number): Promise<string | null> => {
  const fila = await unaFila<{ periodo: string }>(
    `select to_char(periodo, 'YYYY-MM') as periodo
       from v_corte_calculado
      where anio = $1 and (estado_corte is null or estado_corte = 'abierto')
      order by periodo
      limit 1`,
    [anio],
  );
  return fila?.periodo ?? null;
};

// ── Informe mensual ──────────────────────────────────────────────────────────

export type Clasificacion =
  | 'ingreso_interno'
  | 'aportacion_monetaria'
  | 'egreso_ordinario'
  | 'gt_ordinario'
  | 'gt_regularizacion'
  | 'gt_tramite'
  | 'devolucion'
  | 'ajuste';

export const NOMBRE_CLASIFICACION: Record<string, string> = {
  ingreso_interno: 'Ingresos internos',
  aportacion_monetaria: 'Aportaciones monetarias',
  egreso_ordinario: 'Egresos ordinarios',
  gt_ordinario: 'Gran Tesorería, ordinario',
  gt_regularizacion: 'Gran Tesorería, regularizaciones',
  gt_tramite: 'Gran Tesorería, trámites',
  devolucion: 'Devoluciones de gastos por comprobar',
  ajuste: 'Movimientos de ajuste',
};

export interface RenglonInforme {
  tipo: 'ingreso' | 'egreso';
  clasificacion: Clasificacion;
  concepto_nombre: string;
  movimientos: number;
  monto_centavos: number;
}

/** El resumen del mes por clasificación, para el informe que se lee en tenida. */
export const informeMensual = (periodo: string): Promise<RenglonInforme[]> =>
  consulta<RenglonInforme>(
    `select tipo, clasificacion, concepto_nombre, movimientos, monto_centavos
       from v_tesoreria_informe_mensual
      where periodo = $1`,
    [`${periodo}-01`],
  );

export interface AportacionEspecieInforme {
  id: number;
  folio: string;
  fecha: string;
  aportante_nombre: string;
  descripcion: string;
  destino: string | null;
  cantidad: string;
  unidad: string | null;
  valor_estimado_centavos: number | null;
}

/** Aportaciones en especie del mes. Van en el informe pero fuera de toda suma. */
export const aportacionesEspecieDelPeriodo = (
  periodo: string,
): Promise<AportacionEspecieInforme[]> =>
  consulta<AportacionEspecieInforme>(
    `select id, folio, fecha::text, aportante_nombre, descripcion, destino,
            cantidad::text, unidad, valor_estimado_centavos
       from v_aportaciones_especie_periodo
      where periodo = $1`,
    [`${periodo}-01`],
  );

export interface PagoGTInforme {
  folio: string;
  fecha_pago: string;
  monto_centavos: number;
  obligaciones: string | null;
}

/** Pagos a la Gran Tesorería hechos dentro del mes. */
export const pagosGTDelPeriodo = (periodo: string): Promise<PagoGTInforme[]> =>
  consulta<PagoGTInforme>(
    `select p.folio, p.fecha_pago::text, p.monto_centavos,
            (select string_agg(o.folio, ', ' order by o.folio)
               from gt_pago_aplicacion a
               join gt_obligacion o on o.id = a.obligacion_id
              where a.pago_id = p.id) as obligaciones
       from gt_pago p
      where date_trunc('month', p.fecha_pago)::date = $1
      order by p.fecha_pago, p.id`,
    [`${periodo}-01`],
  );
