/*
 * El libro de caja. Insertar aquí es lo único que mueve el saldo.
 */
import { consulta, unaFila, type Tx } from '../db';
import { periodoDe } from '../fechas';

export interface DatosMovimiento {
  fecha: string;
  tipo: 'ingreso' | 'egreso';
  bolsa: 'banco' | 'efectivo';
  conceptoId: number;
  montoCentavos: number;
  descripcion: string;
  hermanoId?: number | null;
  egresoId?: number | null;
  archivoId?: number | null;
}

/** Inserta en el libro. El periodo se deriva de la fecha, nunca se captura. */
export async function insertarMovimiento(
  tx: Tx,
  datos: DatosMovimiento,
  usuarioId: number,
): Promise<number> {
  const periodo = `${periodoDe(datos.fecha)}-01`;
  const anio = Number(datos.fecha.slice(0, 4));

  const fila = await tx.laFila<{ id: number }>(
    `insert into movimiento
       (fecha, ejercicio_anio, periodo, tipo, bolsa, concepto_id, monto_centavos,
        descripcion, hermano_id, egreso_id, archivo_id, creado_por, actualizado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
     returning id`,
    [
      datos.fecha,
      anio,
      periodo,
      datos.tipo,
      datos.bolsa,
      datos.conceptoId,
      datos.montoCentavos,
      datos.descripcion,
      datos.hermanoId ?? null,
      datos.egresoId ?? null,
      datos.archivoId ?? null,
      usuarioId,
    ],
  );
  return fila.id;
}

export interface MovimientoFila {
  id: number;
  fecha: string;
  periodo: string;
  tipo: 'ingreso' | 'egreso';
  bolsa: 'banco' | 'efectivo';
  monto_centavos: number;
  efecto_centavos: number;
  descripcion: string;
  concepto_id: number;
  concepto_nombre: string;
  tipo_especial: string;
  hermano_id: number | null;
  hermano_nombre: string | null;
  egreso_id: number | null;
  archivo_id: number | null;
  corte_id: number | null;
  es_ajuste: boolean;
}

const COLUMNAS = `m.id, m.fecha, m.periodo, m.tipo, m.bolsa, m.monto_centavos, m.efecto_centavos,
       m.descripcion, m.concepto_id, c.nombre as concepto_nombre, c.tipo_especial,
       m.hermano_id, h.nombre_completo as hermano_nombre, m.egreso_id, m.archivo_id,
       m.corte_id,
       exists (select 1 from movimiento_ajuste a where a.movimiento_ajuste_id = m.id)
         as es_ajuste`;

const DESDE = `from movimiento m
       join concepto c on c.id = m.concepto_id
       left join hermano h on h.id = m.hermano_id`;

export interface FiltroMovimientos {
  anio?: number;
  periodo?: string;
  tipo?: 'ingreso' | 'egreso';
  conceptoId?: number;
  hermanoId?: number;
  /** Excluye los conceptos con lógica propia, por ejemplo las cápitas. */
  tiposEspeciales?: string[];
  limite?: number;
}

export function listarMovimientos(filtro: FiltroMovimientos = {}): Promise<MovimientoFila[]> {
  const condiciones: string[] = [];
  const params: unknown[] = [];

  if (filtro.anio) {
    params.push(filtro.anio);
    condiciones.push(`m.ejercicio_anio = $${params.length}`);
  }
  if (filtro.periodo) {
    params.push(`${filtro.periodo}-01`);
    condiciones.push(`m.periodo = $${params.length}`);
  }
  if (filtro.tipo) {
    params.push(filtro.tipo);
    condiciones.push(`m.tipo = $${params.length}`);
  }
  if (filtro.conceptoId) {
    params.push(filtro.conceptoId);
    condiciones.push(`m.concepto_id = $${params.length}`);
  }
  if (filtro.hermanoId) {
    params.push(filtro.hermanoId);
    condiciones.push(`m.hermano_id = $${params.length}`);
  }
  if (filtro.tiposEspeciales && filtro.tiposEspeciales.length > 0) {
    params.push(filtro.tiposEspeciales);
    condiciones.push(`c.tipo_especial = any($${params.length}::text[])`);
  }

  const donde = condiciones.length > 0 ? `where ${condiciones.join(' and ')}` : '';
  const limite = filtro.limite ? `limit ${Number(filtro.limite)}` : '';

  return consulta<MovimientoFila>(
    `select ${COLUMNAS} ${DESDE} ${donde} order by m.fecha desc, m.id desc ${limite}`,
    params,
  );
}

export const obtenerMovimiento = (id: number): Promise<MovimientoFila | null> =>
  unaFila<MovimientoFila>(`select ${COLUMNAS} ${DESDE} where m.id = $1`, [id]);

/** Saldo de caja del ejercicio, total y por bolsa, traspasos incluidos. */
export async function saldoDeCaja(anio: number): Promise<{
  apertura: number;
  ingresos: number;
  egresos: number;
  saldo: number;
  banco: number;
  efectivo: number;
}> {
  const fila = await unaFila<{
    apertura_banco: number;
    apertura_efectivo: number;
    ing_banco: number;
    egr_banco: number;
    ing_efectivo: number;
    egr_efectivo: number;
    hacia_banco: number;
    desde_banco: number;
  }>(
    `select e.apertura_banco_centavos as apertura_banco,
            e.apertura_efectivo_centavos as apertura_efectivo,
            coalesce((select sum(m.monto_centavos) from movimiento m
                       where m.ejercicio_anio = e.anio and m.tipo = 'ingreso'
                         and m.bolsa = 'banco'), 0)::int as ing_banco,
            coalesce((select sum(m.monto_centavos) from movimiento m
                       where m.ejercicio_anio = e.anio and m.tipo = 'egreso'
                         and m.bolsa = 'banco'), 0)::int as egr_banco,
            coalesce((select sum(m.monto_centavos) from movimiento m
                       where m.ejercicio_anio = e.anio and m.tipo = 'ingreso'
                         and m.bolsa = 'efectivo'), 0)::int as ing_efectivo,
            coalesce((select sum(m.monto_centavos) from movimiento m
                       where m.ejercicio_anio = e.anio and m.tipo = 'egreso'
                         and m.bolsa = 'efectivo'), 0)::int as egr_efectivo,
            coalesce((select sum(t.monto_centavos) from traspaso t
                       where t.ejercicio_anio = e.anio and t.a_bolsa = 'banco'), 0)::int
              as hacia_banco,
            coalesce((select sum(t.monto_centavos) from traspaso t
                       where t.ejercicio_anio = e.anio and t.de_bolsa = 'banco'), 0)::int
              as desde_banco
       from ejercicio e
      where e.anio = $1`,
    [anio],
  );

  const banco =
    (fila?.apertura_banco ?? 0) +
    (fila?.ing_banco ?? 0) -
    (fila?.egr_banco ?? 0) +
    (fila?.hacia_banco ?? 0) -
    (fila?.desde_banco ?? 0);
  const efectivo =
    (fila?.apertura_efectivo ?? 0) +
    (fila?.ing_efectivo ?? 0) -
    (fila?.egr_efectivo ?? 0) -
    (fila?.hacia_banco ?? 0) +
    (fila?.desde_banco ?? 0);
  const apertura = (fila?.apertura_banco ?? 0) + (fila?.apertura_efectivo ?? 0);
  const ingresos = (fila?.ing_banco ?? 0) + (fila?.ing_efectivo ?? 0);
  const egresos = (fila?.egr_banco ?? 0) + (fila?.egr_efectivo ?? 0);

  return { apertura, ingresos, egresos, saldo: banco + efectivo, banco, efectivo };
}

/** Totales por concepto de un periodo, para el corte mensual. */
export const totalesPorConcepto = (
  periodo: string,
): Promise<
  {
    tipo: 'ingreso' | 'egreso';
    concepto_nombre: string;
    movimientos: number;
    monto_centavos: number;
  }[]
> =>
  consulta(
    `select m.tipo, c.nombre as concepto_nombre, count(*)::int as movimientos,
            sum(m.monto_centavos)::int as monto_centavos
       from movimiento m
       join concepto c on c.id = m.concepto_id
      where m.periodo = $1
      group by m.tipo, c.nombre
      order by m.tipo desc, sum(m.monto_centavos) desc`,
    [`${periodo}-01`],
  );

/** Registra un movimiento de ajuste ligado al que corrige. */
export async function ligarAjuste(
  tx: Tx,
  ajusteId: number,
  origenId: number,
  motivo: string,
  autorizadoPor: number,
  usuarioId: number,
): Promise<void> {
  await tx.consulta(
    `insert into movimiento_ajuste
       (movimiento_ajuste_id, movimiento_origen_id, motivo, autorizado_por, creado_por)
     values ($1, $2, $3, $4, $5)`,
    [ajusteId, origenId, motivo, autorizadoPor, usuarioId],
  );
}

/*
 * Recibos: solo los ingresos que de verdad recibió la caja de alguien. Quedan
 * fuera las devoluciones de gastos por comprobar y los movimientos de ajuste.
 * El folio es por ejercicio y estable, porque el libro nunca borra: la posición
 * de un movimiento entre los elegibles de su año no cambia jamás.
 */
const PREDICADO_RECIBO = `m.tipo = 'ingreso'
    and c.tipo_especial in ('capita', 'cuota_grado', 'donativo', 'otro')
    and not exists (select 1 from movimiento_ajuste a where a.movimiento_ajuste_id = m.id)`;

export interface Recibo {
  movimiento_id: number;
  folio: string;
  fecha: string;
  monto_centavos: number;
  descripcion: string;
  concepto_nombre: string;
  tipo_especial: string;
  hermano_nombre: string | null;
  archivo_id: number | null;
  capturado_por: string | null;
  /** Meses de cápita que cubrió el pago, si aplica. */
  meses: string | null;
}

export const reciboDe = (movimientoId: number): Promise<Recibo | null> =>
  unaFila<Recibo>(
    `with elegibles as (
       select m.id,
              'REC-' || m.ejercicio_anio || '-'
                || lpad(row_number() over (partition by m.ejercicio_anio order by m.id)::text, 4, '0')
                as folio
         from movimiento m
         join concepto c on c.id = m.concepto_id
        where ${PREDICADO_RECIBO}
     )
     select m.id as movimiento_id, e.folio, m.fecha, m.monto_centavos, m.descripcion,
            c.nombre as concepto_nombre, c.tipo_especial,
            h.nombre_completo as hermano_nombre, m.archivo_id,
            u.nombre as capturado_por,
            (select string_agg(to_char(cc.periodo, 'TMMonth YYYY'), ', ' order by cc.periodo)
               from capita_aplicacion ca
               join capita_cargo cc on cc.id = ca.capita_cargo_id
              where ca.movimiento_id = m.id) as meses
       from movimiento m
       join elegibles e on e.id = m.id
       join concepto c on c.id = m.concepto_id
       left join hermano h on h.id = m.hermano_id
       left join usuario u on u.id = m.creado_por
      where m.id = $1`,
    [movimientoId],
  );

/** Los folios de recibo de varios movimientos, para pintar enlaces en listas. */
export const foliosDeRecibo = (
  movimientoIds: number[],
): Promise<{ movimiento_id: number; folio: string }[]> =>
  movimientoIds.length === 0
    ? Promise.resolve([])
    : consulta(
        `with elegibles as (
           select m.id,
                  'REC-' || m.ejercicio_anio || '-'
                    || lpad(row_number() over (partition by m.ejercicio_anio order by m.id)::text, 4, '0')
                    as folio
             from movimiento m
             join concepto c on c.id = m.concepto_id
            where ${PREDICADO_RECIBO}
         )
         select id as movimiento_id, folio from elegibles where id = any($1::bigint[])`,
        [movimientoIds],
      );
