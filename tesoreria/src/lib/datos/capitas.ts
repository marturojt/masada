/*
 * Consultas de cápitas. La lógica de generación de cargos vive en la función
 * fn_asignar_capita de la base, para que no haya dos versiones de la regla.
 */
import { consulta, unaFila, type Tx } from '../db';
import type { Grado } from '../tipos';

export type Modalidad = 'mensual' | 'promocion' | 'prorrateo';

export const NOMBRE_MODALIDAD: Record<Modalidad, string> = {
  mensual: 'Mensual, 500 al mes',
  promocion: 'Anual preferencial, pago único',
  prorrateo: 'Prorrateo por meses restantes',
};

export type EstadoPago =
  | 'cubierto'
  | 'parcial'
  | 'pendiente'
  | 'vencido'
  | 'vencido_parcial';

export interface AdeudoMes {
  capita_cargo_id: number;
  hermano_id: number;
  nombre_completo: string;
  estatus_hermano: 'activo' | 'baja';
  ejercicio_anio: number;
  periodo: string;
  clase: 'mensual' | 'promocion';
  monto_esperado_centavos: number;
  pagado_centavos: number;
  condonado_centavos: number;
  saldo_centavos: number;
  estado_pago: EstadoPago;
}

export const adeudosDelAnio = (anio: number): Promise<AdeudoMes[]> =>
  consulta<AdeudoMes>(
    `select * from v_adeudo_capita_mes
      where ejercicio_anio = $1
      order by nombre_completo, periodo`,
    [anio],
  );

export const adeudosDeHermano = (hermanoId: number, anio: number): Promise<AdeudoMes[]> =>
  consulta<AdeudoMes>(
    `select * from v_adeudo_capita_mes
      where hermano_id = $1 and ejercicio_anio = $2
      order by periodo`,
    [hermanoId, anio],
  );

export interface EstadoCuenta {
  hermano_id: number;
  nombre_completo: string;
  grado: Grado;
  estatus: 'activo' | 'baja';
  ejercicio_anio: number;
  modalidad: Modalidad | null;
  plan_id: number | null;
  esperado_centavos: number;
  pagado_centavos: number;
  condonado_centavos: number;
  adeudo_centavos: number;
  saldo_a_favor_centavos: number;
  meses_vencidos: number;
  meses: number;
  al_corriente: boolean;
}

export const estadosDeCuenta = (anio: number): Promise<EstadoCuenta[]> =>
  consulta<EstadoCuenta>(
    `select * from v_estado_cuenta_capita
      where ejercicio_anio = $1
      order by al_corriente, adeudo_centavos desc, nombre_completo`,
    [anio],
  );

export const estadoDeCuenta = (
  hermanoId: number,
  anio: number,
): Promise<EstadoCuenta | null> =>
  unaFila<EstadoCuenta>(
    'select * from v_estado_cuenta_capita where hermano_id = $1 and ejercicio_anio = $2',
    [hermanoId, anio],
  );

/** Hermanos activos sin plan de cápita del ejercicio, que es lo primero a resolver. */
export const sinPlan = (
  anio: number,
): Promise<{ id: number; nombre_completo: string; grado: Grado; fecha_ingreso: string }[]> =>
  consulta(
    `select h.id, h.nombre_completo, h.grado, h.fecha_ingreso
       from hermano h
      where h.estatus = 'activo'
        and not exists (
          select 1 from capita_plan p
           where p.hermano_id = h.id and p.ejercicio_anio = $1 and p.vigente
        )
      order by h.grado desc, h.nombre_completo`,
    [anio],
  );

export interface PlanVigente {
  id: number;
  modalidad: Modalidad;
  mes_desde: number;
  mes_hasta: number;
  monto_total_centavos: number;
  autorizado_por: number | null;
  autorizado_nombre: string | null;
  autorizado_en: string | null;
  motivo: string | null;
}

export const planVigente = (
  hermanoId: number,
  anio: number,
): Promise<PlanVigente | null> =>
  unaFila<PlanVigente>(
    `select p.id, p.modalidad, p.mes_desde, p.mes_hasta, p.monto_total_centavos,
            p.autorizado_por, u.nombre as autorizado_nombre, p.autorizado_en::text,
            p.motivo
       from capita_plan p
       left join usuario u on u.id = p.autorizado_por
      where p.hermano_id = $1 and p.ejercicio_anio = $2 and p.vigente`,
    [hermanoId, anio],
  );

/**
 * Llama a la función de la base que asigna la modalidad. Toda la regla vive allá:
 * meses que corresponden, qué se conserva al cambiar a media marcha y qué se
 * descuenta del nuevo total.
 */
export async function asignarCapitaEnBase(
  tx: Tx,
  hermanoId: number,
  anio: number,
  modalidad: Modalidad,
  mesPromocion: number | null,
  autorizadoPor: number | null,
  motivo: string | null,
): Promise<number> {
  const fila = await tx.laFila<{ plan_id: number }>(
    'select fn_asignar_capita($1, $2, $3, $4, $5, $6) as plan_id',
    [hermanoId, anio, modalidad, mesPromocion, autorizadoPor, motivo],
  );
  return fila.plan_id;
}

/** Cargos con saldo, del más antiguo al más reciente. Es el orden de aplicación. */
export const cargosConSaldo = (
  tx: Tx,
  hermanoId: number,
  anio: number,
): Promise<{ capita_cargo_id: number; periodo: string; saldo_centavos: number }[]> =>
  tx.consulta(
    `select capita_cargo_id, periodo, saldo_centavos
       from v_adeudo_capita_mes
      where hermano_id = $1 and ejercicio_anio = $2 and saldo_centavos > 0
      order by periodo`,
    [hermanoId, anio],
  );

export async function aplicarACargo(
  tx: Tx,
  movimientoId: number,
  cargoId: number,
  montoCentavos: number,
  usuarioId: number,
): Promise<void> {
  await tx.consulta(
    `insert into capita_aplicacion
       (movimiento_id, capita_cargo_id, monto_aplicado_centavos, creado_por)
     values ($1, $2, $3, $4)`,
    [movimientoId, cargoId, montoCentavos, usuarioId],
  );
}

export async function condonarCargo(
  tx: Tx,
  cargoId: number,
  montoCentavos: number,
  motivo: string,
  autorizadoPor: number,
): Promise<void> {
  await tx.consulta(
    `insert into capita_condonacion
       (capita_cargo_id, monto_centavos, motivo, autorizado_por, creado_por)
     values ($1, $2, $3, $4, $4)
     on conflict (capita_cargo_id) do update
       set monto_centavos = excluded.monto_centavos,
           motivo = excluded.motivo,
           autorizado_por = excluded.autorizado_por,
           autorizado_en = now()`,
    [cargoId, montoCentavos, motivo, autorizadoPor],
  );
}

export interface CondonacionFila {
  capita_cargo_id: number;
  periodo: string;
  monto_centavos: number;
  motivo: string;
  autorizado_nombre: string;
  autorizado_en: string;
}

export const condonacionesDeHermano = (
  hermanoId: number,
  anio: number,
): Promise<CondonacionFila[]> =>
  consulta<CondonacionFila>(
    `select co.capita_cargo_id, cc.periodo, co.monto_centavos, co.motivo,
            u.nombre as autorizado_nombre, co.autorizado_en::text
       from capita_condonacion co
       join capita_cargo cc on cc.id = co.capita_cargo_id
       join usuario u on u.id = co.autorizado_por
      where cc.hermano_id = $1 and cc.ejercicio_anio = $2
      order by cc.periodo`,
    [hermanoId, anio],
  );

/** Pagos de cápita de un hermano, con los meses que cubrió cada uno. */
export interface PagoCapita {
  movimiento_id: number;
  fecha: string;
  monto_centavos: number;
  aplicado_centavos: number;
  descripcion: string;
  archivo_id: number | null;
  meses: string | null;
}

export const pagosDeHermano = (hermanoId: number, anio: number): Promise<PagoCapita[]> =>
  consulta<PagoCapita>(
    `select m.id as movimiento_id, m.fecha, m.monto_centavos, m.descripcion, m.archivo_id,
            coalesce(sum(ca.monto_aplicado_centavos), 0)::int as aplicado_centavos,
            string_agg(to_char(cc.periodo, 'YYYY-MM'), ', ' order by cc.periodo) as meses
       from movimiento m
       join concepto c on c.id = m.concepto_id and c.tipo_especial = 'capita'
       left join capita_aplicacion ca on ca.movimiento_id = m.id
       left join capita_cargo cc on cc.id = ca.capita_cargo_id
      where m.hermano_id = $1 and m.ejercicio_anio = $2 and m.tipo = 'ingreso'
      group by m.id, m.fecha, m.monto_centavos, m.descripcion, m.archivo_id
      order by m.fecha desc, m.id desc`,
    [hermanoId, anio],
  );

/** Totales del ejercicio, para el encabezado del módulo. */
export const resumenCapitas = (
  anio: number,
): Promise<{
  esperado: number;
  pagado: number;
  condonado: number;
  adeudo: number;
  al_corriente: number;
  con_adeudo: number;
} | null> =>
  unaFila(
    `select coalesce(sum(esperado_centavos), 0)::int as esperado,
            coalesce(sum(pagado_centavos), 0)::int as pagado,
            coalesce(sum(condonado_centavos), 0)::int as condonado,
            coalesce(sum(adeudo_centavos), 0)::int as adeudo,
            count(*) filter (where al_corriente)::int as al_corriente,
            count(*) filter (where not al_corriente)::int as con_adeudo
       from v_estado_cuenta_capita
      where ejercicio_anio = $1`,
    [anio],
  );

/**
 * Saldo a favor que de verdad se puede usar: pagos de cápita menos lo aplicado,
 * menos lo ya devuelto o en trámite de devolución. Se calcula sobre todos los
 * ejercicios, porque el sobrante de un año sirve para el siguiente.
 */
export async function saldoAFavorDisponible(hermanoId: number): Promise<number> {
  const fila = await unaFila<{ disponible: number }>(
    `with pagos as (
       select coalesce(sum(m.monto_centavos), 0)::int as s
         from movimiento m
         join concepto c on c.id = m.concepto_id
        where m.hermano_id = $1 and m.tipo = 'ingreso' and c.tipo_especial = 'capita'
     ),
     aplicado as (
       select coalesce(sum(ca.monto_aplicado_centavos), 0)::int as s
         from capita_aplicacion ca
         join movimiento m on m.id = ca.movimiento_id
        where m.hermano_id = $1
     ),
     -- Cuenta también las devoluciones todavía en trámite, para que dos clics
     -- seguidos no puedan prometer el mismo dinero dos veces.
     devuelto as (
       select coalesce(sum(coalesce(e.monto_entregado_centavos,
                                    e.monto_autorizado_centavos,
                                    e.monto_solicitado_centavos)), 0)::int as s
         from egreso e
         join concepto c on c.id = e.concepto_id
        where e.hermano_id = $1
          and c.clave = 'devolucion_saldo_favor'
          and e.estado not in ('rechazado', 'cancelado')
     )
     select greatest((select s from pagos) - (select s from aplicado)
                     - (select s from devuelto), 0) as disponible`,
    [hermanoId],
  );
  return fila?.disponible ?? 0;
}

/** Restante sin aplicar de cada pago de cápita, del más viejo al más nuevo. */
export const pagosConRestante = (
  tx: Tx,
  hermanoId: number,
): Promise<{ movimiento_id: number; restante: number }[]> =>
  tx.consulta(
    `select m.id as movimiento_id,
            (m.monto_centavos - coalesce(sum(ca.monto_aplicado_centavos), 0))::int
              as restante
       from movimiento m
       join concepto c on c.id = m.concepto_id
       left join capita_aplicacion ca on ca.movimiento_id = m.id
      where m.hermano_id = $1 and m.tipo = 'ingreso' and c.tipo_especial = 'capita'
      group by m.id
     having m.monto_centavos - coalesce(sum(ca.monto_aplicado_centavos), 0) > 0
      order by m.fecha, m.id`,
    [hermanoId],
  );

/** Cargos con saldo de ejercicios abiertos, del mes más antiguo hacia adelante. */
export const cargosConSaldoAbiertos = (
  tx: Tx,
  hermanoId: number,
): Promise<{ capita_cargo_id: number; periodo: string; saldo_centavos: number }[]> =>
  tx.consulta(
    `select a.capita_cargo_id, a.periodo::text, a.saldo_centavos
       from v_adeudo_capita_mes a
       join ejercicio e on e.anio = a.ejercicio_anio and e.estado = 'abierto'
      where a.hermano_id = $1 and a.saldo_centavos > 0
      order by a.periodo`,
    [hermanoId],
  );
