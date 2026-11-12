/*
 * Estado general detallado: el estado general más todo el movimiento de dinero
 * del ejercicio. Mes por mes, por concepto, por hermano, por beneficiario, el
 * libro completo de ingresos y de egresos, el ciclo de cada egreso y los
 * traspasos entre bolsas. Lo usan la página, la hoja impresa y el CSV.
 *
 * Es de uso interno: lleva nombres de hermanos y de beneficiarios.
 */
import { consulta } from '../db';
import { cortesDelAnio, type CorteCalculado } from './cortes';
import { listarEgresos, NOMBRE_ESTADO_EGRESO, type EgresoFila } from './egresos';
import { estadoGeneral, filasCSV as filasCSVGeneral, type EstadoGeneral } from './estado-general';
import { saldoDeCaja } from './movimientos';
import { listarTraspasos, type TraspasoFila } from './traspasos';
import { nombrePeriodo } from '../fechas';
import { cuenta } from '../texto';
import { NOMBRE_BOLSA, type Bolsa } from '../tipos';

/** Un renglón del libro: el movimiento con todo lo que lo explica. */
export interface MovimientoDetalle {
  id: number;
  fecha: string;
  periodo: string;
  tipo: 'ingreso' | 'egreso';
  bolsa: Bolsa;
  monto_centavos: number;
  descripcion: string;
  concepto_nombre: string;
  tipo_especial: string;
  hermano_id: number | null;
  hermano_nombre: string | null;
  /** REC- del recibo en ingresos, folio del egreso en egresos. */
  folio: string | null;
  egreso_id: number | null;
  beneficiario: string | null;
  tiene_comprobante: boolean;
  capturado_por: string | null;
  /** Meses de cápita que cubrió el pago, ya en palabras. */
  meses: string | null;
  /** Si es un ajuste: el movimiento que corrige y por qué. */
  ajusta_a: number | null;
  motivo_ajuste: string | null;
  /** Si fue corregido: la suma de sus ajustes. */
  ajustado_centavos: number;
}

export interface TotalConcepto {
  tipo: 'ingreso' | 'egreso';
  concepto_nombre: string;
  movimientos: number;
  monto_centavos: number;
  banco_centavos: number;
  efectivo_centavos: number;
}

export interface IngresoHermano {
  hermano_id: number;
  nombre: string;
  movimientos: number;
  capitas_centavos: number;
  cuotas_centavos: number;
  otros_centavos: number;
  total_centavos: number;
}

export interface EgresoBeneficiario {
  beneficiario: string;
  movimientos: number;
  monto_centavos: number;
}

export interface EstadoDetallado {
  general: EstadoGeneral;
  resumen: {
    apertura: number;
    ingresos: number;
    egresos: number;
    resultado: number;
    saldo: number;
    movIngresos: number;
    movEgresos: number;
  };
  meses: CorteCalculado[];
  porConcepto: { ingresos: TotalConcepto[]; egresos: TotalConcepto[] };
  porHermano: IngresoHermano[];
  porBeneficiario: EgresoBeneficiario[];
  ingresos: MovimientoDetalle[];
  egresos: MovimientoDetalle[];
  ciclo: EgresoFila[];
  traspasos: TraspasoFila[];
}

const libroDelEjercicio = (anio: number): Promise<MovimientoDetalle[]> =>
  consulta<MovimientoDetalle>(
    `with recibos as (
       select m.id,
              'REC-' || m.ejercicio_anio || '-'
                || lpad(row_number() over (partition by m.ejercicio_anio order by m.id)::text, 4, '0')
                as folio
         from movimiento m
         join concepto c on c.id = m.concepto_id
        where m.tipo = 'ingreso'
          and c.tipo_especial in ('capita', 'cuota_grado', 'donativo', 'otro')
          and not exists (select 1 from movimiento_ajuste a where a.movimiento_ajuste_id = m.id)
     )
     select m.id, m.fecha::text, m.periodo::text, m.tipo, m.bolsa, m.monto_centavos,
            m.descripcion, c.nombre as concepto_nombre, c.tipo_especial,
            m.hermano_id, h.nombre_completo as hermano_nombre,
            coalesce(r.folio, e.folio) as folio, m.egreso_id, e.beneficiario,
            m.archivo_id is not null as tiene_comprobante,
            u.nombre as capturado_por,
            (select array_agg(distinct to_char(cc.periodo, 'YYYY-MM'))
               from capita_aplicacion ca
               join capita_cargo cc on cc.id = ca.capita_cargo_id
              where ca.movimiento_id = m.id) as meses,
            aj.movimiento_origen_id as ajusta_a, aj.motivo as motivo_ajuste,
            coalesce((select sum(a2.monto_centavos)::int
                        from movimiento_ajuste x
                        join movimiento a2 on a2.id = x.movimiento_ajuste_id
                       where x.movimiento_origen_id = m.id), 0) as ajustado_centavos
       from movimiento m
       join concepto c on c.id = m.concepto_id
       left join hermano h on h.id = m.hermano_id
       left join recibos r on r.id = m.id
       left join egreso e on e.id = m.egreso_id
       left join usuario u on u.id = m.creado_por
       left join movimiento_ajuste aj on aj.movimiento_ajuste_id = m.id
      where m.ejercicio_anio = $1
      order by m.fecha, m.id`,
    [anio],
  );

const totalesPorConceptoDelAnio = (anio: number): Promise<TotalConcepto[]> =>
  consulta<TotalConcepto>(
    `select m.tipo, c.nombre as concepto_nombre, count(*)::int as movimientos,
            sum(m.monto_centavos)::int as monto_centavos,
            coalesce(sum(m.monto_centavos) filter (where m.bolsa = 'banco'), 0)::int as banco_centavos,
            coalesce(sum(m.monto_centavos) filter (where m.bolsa = 'efectivo'), 0)::int as efectivo_centavos
       from movimiento m
       join concepto c on c.id = m.concepto_id
      where m.ejercicio_anio = $1
      group by m.tipo, c.nombre
      order by sum(m.monto_centavos) desc, c.nombre`,
    [anio],
  );

const ingresosPorHermano = (anio: number): Promise<IngresoHermano[]> =>
  consulta<IngresoHermano>(
    `select h.id as hermano_id, h.nombre_completo as nombre, count(*)::int as movimientos,
            coalesce(sum(m.monto_centavos) filter (where c.tipo_especial = 'capita'), 0)::int
              as capitas_centavos,
            coalesce(sum(m.monto_centavos) filter (where c.tipo_especial = 'cuota_grado'), 0)::int
              as cuotas_centavos,
            coalesce(sum(m.monto_centavos)
                       filter (where c.tipo_especial not in ('capita', 'cuota_grado')), 0)::int
              as otros_centavos,
            sum(m.monto_centavos)::int as total_centavos
       from movimiento m
       join concepto c on c.id = m.concepto_id
       join hermano h on h.id = m.hermano_id
      where m.ejercicio_anio = $1 and m.tipo = 'ingreso'
      group by h.id, h.nombre_completo
      order by sum(m.monto_centavos) desc, h.nombre_completo`,
    [anio],
  );

const egresosPorBeneficiario = (anio: number): Promise<EgresoBeneficiario[]> =>
  consulta<EgresoBeneficiario>(
    `select coalesce(e.beneficiario, h.nombre_completo, 'Sin beneficiario registrado') as beneficiario,
            count(*)::int as movimientos, sum(m.monto_centavos)::int as monto_centavos
       from movimiento m
       left join egreso e on e.id = m.egreso_id
       left join hermano h on h.id = m.hermano_id
      where m.ejercicio_anio = $1 and m.tipo = 'egreso'
      group by 1
      order by sum(m.monto_centavos) desc, 1`,
    [anio],
  );

export async function estadoDetallado(anio: number): Promise<EstadoDetallado> {
  const [general, caja, meses, conceptos, porHermano, porBeneficiario, libro, ciclo, traspasos] =
    await Promise.all([
      estadoGeneral(anio),
      saldoDeCaja(anio),
      cortesDelAnio(anio),
      totalesPorConceptoDelAnio(anio),
      ingresosPorHermano(anio),
      egresosPorBeneficiario(anio),
      libroDelEjercicio(anio),
      listarEgresos({ anio }),
      listarTraspasos(anio),
    ]);

  /* Los meses se nombran aquí, no en SQL: así no dependen del idioma de la base. */
  for (const m of libro) {
    const crudos = m.meses as unknown as string[] | null;
    m.meses = crudos && crudos.length > 0 ? [...crudos].sort().map(nombrePeriodo).join(', ') : null;
  }
  const ingresos = libro.filter((m) => m.tipo === 'ingreso');
  const egresos = libro.filter((m) => m.tipo === 'egreso');

  return {
    general,
    resumen: {
      apertura: caja.apertura,
      ingresos: caja.ingresos,
      egresos: caja.egresos,
      resultado: caja.ingresos - caja.egresos,
      saldo: caja.saldo,
      movIngresos: ingresos.length,
      movEgresos: egresos.length,
    },
    meses,
    porConcepto: {
      ingresos: conceptos.filter((c) => c.tipo === 'ingreso'),
      egresos: conceptos.filter((c) => c.tipo === 'egreso'),
    },
    porHermano,
    porBeneficiario,
    ingresos,
    egresos,
    /* El ciclo de cada egreso, del más viejo al más nuevo. */
    ciclo: [...ciclo].reverse(),
    traspasos: [...traspasos].reverse(),
  };
}

/** Cómo se lee el movimiento en una línea: ajuste, corregido o normal. */
export const notaDeMovimiento = (m: MovimientoDetalle): string | null => {
  if (m.ajusta_a) return `Ajuste de un movimiento anterior: ${m.motivo_ajuste ?? ''}`.trim();
  if (m.ajustado_centavos !== 0) return 'Corregido después con un ajuste';
  return null;
};

const pesos = (centavos: number | null): string =>
  centavos == null ? '' : (centavos / 100).toFixed(2);

/**
 * CSV del estado detallado: las filas del estado general y, después, el libro
 * de ingresos y egresos con sus columnas propias. Un solo archivo; la columna
 * Sección permite filtrar.
 */
export function filasCSVDetallado(d: EstadoDetallado): {
  encabezados: string[];
  filas: (string | number | null)[][];
} {
  const general = filasCSVGeneral(d.general);
  const encabezados = [
    'Sección',
    'Concepto',
    'Persona',
    'Detalle',
    'Monto',
    'Fecha',
    'Folio',
    'Bolsa',
    'Comprobante',
    'Capturó',
  ];
  const filas: (string | number | null)[][] = general.filas.map((f) => [...f, null, null, null, null, null]);

  const r = d.resumen;
  filas.push(['Resumen del ejercicio', 'Saldo de apertura', null, null, pesos(r.apertura), null, null, null, null, null]);
  filas.push(['Resumen del ejercicio', 'Ingresos', null, cuenta(r.movIngresos, 'movimiento', 'movimientos'), pesos(r.ingresos), null, null, null, null, null]);
  filas.push(['Resumen del ejercicio', 'Egresos', null, cuenta(r.movEgresos, 'movimiento', 'movimientos'), pesos(r.egresos), null, null, null, null, null]);
  filas.push(['Resumen del ejercicio', 'Resultado', null, null, pesos(r.resultado), null, null, null, null, null]);

  for (const m of d.meses) {
    const mes = m.periodo.slice(0, 7);
    filas.push(['Mes', 'Ingresos', null, mes, pesos(m.total_ingresos_centavos), null, null, null, null, null]);
    filas.push(['Mes', 'Egresos', null, mes, pesos(m.total_egresos_centavos), null, null, null, null, null]);
    filas.push(['Mes', 'Saldo final', null, mes, pesos(m.saldo_final_centavos), null, null, null, null, null]);
  }

  for (const c of [...d.porConcepto.ingresos, ...d.porConcepto.egresos]) {
    filas.push([
      c.tipo === 'ingreso' ? 'Ingresos por concepto' : 'Egresos por concepto',
      c.concepto_nombre,
      null,
      cuenta(c.movimientos, 'movimiento', 'movimientos'),
      pesos(c.monto_centavos),
      null, null, null, null, null,
    ]);
  }

  for (const h of d.porHermano) {
    filas.push(['Ingresos por hermano', 'Total del ejercicio', h.nombre, `Cápitas ${pesos(h.capitas_centavos)}, cuotas ${pesos(h.cuotas_centavos)}, otros ${pesos(h.otros_centavos)}`, pesos(h.total_centavos), null, null, null, null, null]);
  }

  for (const b of d.porBeneficiario) {
    filas.push(['Egresos por beneficiario', 'Total del ejercicio', b.beneficiario, cuenta(b.movimientos, 'movimiento', 'movimientos'), pesos(b.monto_centavos), null, null, null, null, null]);
  }

  for (const m of [...d.ingresos, ...d.egresos]) {
    const detalle = [m.descripcion, m.meses ? `Meses: ${m.meses}` : null, notaDeMovimiento(m)]
      .filter(Boolean)
      .join('. ');
    filas.push([
      m.tipo === 'ingreso' ? 'Libro de ingresos' : 'Libro de egresos',
      m.concepto_nombre,
      m.tipo === 'ingreso' ? m.hermano_nombre : (m.beneficiario ?? m.hermano_nombre),
      detalle,
      pesos(m.monto_centavos),
      m.fecha,
      m.folio,
      NOMBRE_BOLSA[m.bolsa],
      m.tiene_comprobante ? 'Sí' : 'No',
      m.capturado_por,
    ]);
  }

  for (const g of d.ciclo) {
    filas.push([
      'Ciclo de egresos',
      g.concepto_nombre,
      g.beneficiario,
      `${NOMBRE_ESTADO_EGRESO[g.estado]}. Solicitado ${pesos(g.monto_solicitado_centavos)}, autorizado ${pesos(g.monto_autorizado_centavos)}, entregado ${pesos(g.monto_entregado_centavos)}, comprobado ${pesos(g.monto_comprobado_centavos)}, devuelto ${pesos(g.monto_devuelto_centavos)}`,
      pesos(g.monto_entregado_centavos ?? g.monto_autorizado_centavos ?? g.monto_solicitado_centavos),
      g.fecha_solicitud,
      g.folio,
      null,
      null,
      null,
    ]);
  }

  for (const t of d.traspasos) {
    filas.push([
      'Traspaso',
      `De ${NOMBRE_BOLSA[t.de_bolsa]} a ${NOMBRE_BOLSA[t.a_bolsa]}`,
      null,
      t.descripcion,
      pesos(t.monto_centavos),
      t.fecha,
      null,
      null,
      t.archivo_id ? 'Sí' : 'No',
      t.creado_nombre,
    ]);
  }

  return { encabezados, filas };
}
