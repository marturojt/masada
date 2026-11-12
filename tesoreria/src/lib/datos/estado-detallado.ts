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
import { formatoMXN } from '../dinero';
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
  concepto_nombre: string;
  movimientos: number;
  /** Lo capturado, antes de correcciones. */
  capturado_centavos: number;
  /** Lo que restan las correcciones de captura ligadas a estos movimientos. */
  corregido_centavos: number;
  /** Lo que de verdad entró o salió: capturado menos corregido. */
  neto_centavos: number;
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
  corregido_centavos: number;
  total_centavos: number;
}

export interface EgresoBeneficiario {
  beneficiario: string;
  movimientos: number;
  monto_centavos: number;
}

/** Una corrección de captura con el movimiento que corrige. */
export interface Correccion {
  ajuste: MovimientoDetalle;
  /** El movimiento corregido, si es de este ejercicio. */
  origen: MovimientoDetalle | null;
}

export interface MesDetalle extends CorteCalculado {
  /** Ingresos y egresos capturados en el mes, sin las correcciones. */
  ingresos_centavos: number;
  egresos_centavos: number;
  /**
   * Efecto de las correcciones registradas en el mes, con signo: restan si
   * corrigen un ingreso, suman si corrigen un egreso. Así el resultado del mes
   * es el mismo que el del corte.
   */
  correcciones_centavos: number;
}

export interface EstadoDetallado {
  general: EstadoGeneral;
  resumen: {
    apertura: number;
    ingresosCapturados: number;
    ingresosCorregidos: number;
    ingresos: number;
    egresosCapturados: number;
    egresosCorregidos: number;
    egresos: number;
    resultado: number;
    saldo: number;
    movIngresos: number;
    movEgresos: number;
  };
  meses: MesDetalle[];
  porConcepto: { ingresos: TotalConcepto[]; egresos: TotalConcepto[] };
  porHermano: IngresoHermano[];
  porBeneficiario: EgresoBeneficiario[];
  /** Libros sin las correcciones: esas van aparte, ligadas a lo que corrigen. */
  ingresos: MovimientoDetalle[];
  egresos: MovimientoDetalle[];
  correcciones: Correccion[];
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

const suma = <T>(lista: T[], f: (x: T) => number): number => lista.reduce((s, x) => s + f(x), 0);

/*
 * Totales por concepto en neto. Una corrección de captura (ajuste) va en
 * sentido contrario y con su propio concepto; aquí se resta del concepto del
 * movimiento que corrige, en la bolsa por la que se registró. Si corrige algo
 * de otro ejercicio, queda en una fila propia.
 */
function porConceptoNeto(movs: MovimientoDetalle[], correcciones: Correccion[]): TotalConcepto[] {
  const mapa = new Map<string, TotalConcepto>();
  const fila = (nombre: string): TotalConcepto => {
    let f = mapa.get(nombre);
    if (!f) {
      f = { concepto_nombre: nombre, movimientos: 0, capturado_centavos: 0, corregido_centavos: 0, neto_centavos: 0, banco_centavos: 0, efectivo_centavos: 0 };
      mapa.set(nombre, f);
    }
    return f;
  };
  for (const m of movs) {
    const f = fila(m.concepto_nombre);
    f.movimientos += 1;
    f.capturado_centavos += m.monto_centavos;
    f[m.bolsa === 'banco' ? 'banco_centavos' : 'efectivo_centavos'] += m.monto_centavos;
  }
  for (const c of correcciones) {
    const f = fila(c.origen ? c.origen.concepto_nombre : `Corrección de un movimiento de otro ejercicio`);
    f.corregido_centavos += c.ajuste.monto_centavos;
    f[c.ajuste.bolsa === 'banco' ? 'banco_centavos' : 'efectivo_centavos'] -= c.ajuste.monto_centavos;
  }
  for (const f of mapa.values()) f.neto_centavos = f.capturado_centavos - f.corregido_centavos;
  return [...mapa.values()].sort((a, b) => b.neto_centavos - a.neto_centavos || a.concepto_nombre.localeCompare(b.concepto_nombre));
}

export async function estadoDetallado(anio: number): Promise<EstadoDetallado> {
  const [general, caja, cortes, libro, ciclo, traspasos] = await Promise.all([
    estadoGeneral(anio),
    saldoDeCaja(anio),
    cortesDelAnio(anio),
    libroDelEjercicio(anio),
    listarEgresos({ anio }),
    listarTraspasos(anio),
  ]);

  /* Los meses se nombran aquí, no en SQL: así no dependen del idioma de la base. */
  for (const m of libro) {
    const crudos = m.meses as unknown as string[] | null;
    m.meses = crudos && crudos.length > 0 ? [...crudos].sort().map(nombrePeriodo).join(', ') : null;
  }

  const porId = new Map(libro.map((m) => [m.id, m]));
  const ajustes = libro.filter((m) => m.ajusta_a);
  const correcciones: Correccion[] = ajustes.map((a) => ({ ajuste: a, origen: porId.get(a.ajusta_a!) ?? null }));
  /* Un ajuste de tipo egreso corrige un ingreso, y al revés. */
  const corrigenIngresos = correcciones.filter((c) => c.ajuste.tipo === 'egreso');
  const corrigenEgresos = correcciones.filter((c) => c.ajuste.tipo === 'ingreso');

  const ingresos = libro.filter((m) => m.tipo === 'ingreso' && !m.ajusta_a);
  const egresos = libro.filter((m) => m.tipo === 'egreso' && !m.ajusta_a);

  /* Lo corregido dentro de este ejercicio, por movimiento original. */
  const corregidoDe = new Map<number, number>();
  for (const c of correcciones) {
    if (c.origen) corregidoDe.set(c.origen.id, (corregidoDe.get(c.origen.id) ?? 0) + c.ajuste.monto_centavos);
  }
  const neto = (m: MovimientoDetalle) => m.monto_centavos - (corregidoDe.get(m.id) ?? 0);

  const ingresosCapturados = suma(ingresos, (m) => m.monto_centavos);
  const ingresosCorregidos = suma(corrigenIngresos, (c) => c.ajuste.monto_centavos);
  const egresosCapturados = suma(egresos, (m) => m.monto_centavos);
  const egresosCorregidos = suma(corrigenEgresos, (c) => c.ajuste.monto_centavos);

  /* Mes por mes: la corrección cuenta en el mes en que se registró, como en el corte. */
  const meses: MesDetalle[] = cortes.map((c) => {
    const delMes = (m: MovimientoDetalle) => m.periodo.slice(0, 7) === c.periodo.slice(0, 7);
    const enMes = (lista: MovimientoDetalle[]) => suma(lista.filter(delMes), (m) => m.monto_centavos);
    return {
      ...c,
      ingresos_centavos: enMes(ingresos),
      egresos_centavos: enMes(egresos),
      correcciones_centavos: suma(ajustes.filter(delMes), (a) => (a.tipo === 'ingreso' ? a.monto_centavos : -a.monto_centavos)),
    };
  });

  /* Por hermano: lo que de verdad pagó cada uno, ya corregido. */
  const hermanos = new Map<number, IngresoHermano>();
  for (const m of ingresos) {
    if (!m.hermano_id) continue;
    let h = hermanos.get(m.hermano_id);
    if (!h) {
      h = { hermano_id: m.hermano_id, nombre: m.hermano_nombre ?? '', movimientos: 0, capitas_centavos: 0, cuotas_centavos: 0, otros_centavos: 0, corregido_centavos: 0, total_centavos: 0 };
      hermanos.set(m.hermano_id, h);
    }
    const n = neto(m);
    h.movimientos += 1;
    h.corregido_centavos += m.monto_centavos - n;
    h.total_centavos += n;
    if (m.tipo_especial === 'capita') h.capitas_centavos += n;
    else if (m.tipo_especial === 'cuota_grado') h.cuotas_centavos += n;
    else h.otros_centavos += n;
  }

  /* Por beneficiario: solo salidas reales de dinero, ya corregidas. */
  const beneficiarios = new Map<string, EgresoBeneficiario>();
  for (const m of egresos) {
    const nombre = m.beneficiario ?? m.hermano_nombre ?? 'Sin beneficiario registrado';
    const b = beneficiarios.get(nombre) ?? { beneficiario: nombre, movimientos: 0, monto_centavos: 0 };
    b.movimientos += 1;
    b.monto_centavos += neto(m);
    beneficiarios.set(nombre, b);
  }

  return {
    general,
    resumen: {
      apertura: caja.apertura,
      ingresosCapturados,
      ingresosCorregidos,
      ingresos: ingresosCapturados - ingresosCorregidos,
      egresosCapturados,
      egresosCorregidos,
      egresos: egresosCapturados - egresosCorregidos,
      resultado: caja.ingresos - caja.egresos,
      saldo: caja.saldo,
      movIngresos: ingresos.length,
      movEgresos: egresos.length,
    },
    meses,
    porConcepto: {
      ingresos: porConceptoNeto(ingresos, corrigenIngresos),
      egresos: porConceptoNeto(egresos, corrigenEgresos),
    },
    porHermano: [...hermanos.values()].sort((a, b) => b.total_centavos - a.total_centavos || a.nombre.localeCompare(b.nombre)),
    porBeneficiario: [...beneficiarios.values()]
      .filter((b) => b.monto_centavos !== 0)
      .sort((a, b) => b.monto_centavos - a.monto_centavos || a.beneficiario.localeCompare(b.beneficiario)),
    ingresos,
    egresos,
    correcciones,
    /* El ciclo de cada egreso, del más viejo al más nuevo. */
    ciclo: [...ciclo].reverse(),
    traspasos: [...traspasos].reverse(),
  };
}

/** Cómo se lee el movimiento en una línea: ajuste, corregido o normal. */
export const notaDeMovimiento = (m: MovimientoDetalle): string | null =>
  m.ajustado_centavos !== 0
    ? `Captura corregida: se restaron ${formatoMXN(m.ajustado_centavos)}, lo real fue ${formatoMXN(m.monto_centavos - m.ajustado_centavos)}`
    : null;

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
  const res = (concepto: string, detalle: string | null, monto: number) =>
    filas.push(['Resumen del ejercicio', concepto, null, detalle, pesos(monto), null, null, null, null, null]);
  res('Saldo de apertura', null, r.apertura);
  res('Ingresos capturados', cuenta(r.movIngresos, 'movimiento', 'movimientos'), r.ingresosCapturados);
  if (r.ingresosCorregidos > 0) res('Correcciones de captura en ingresos', null, -r.ingresosCorregidos);
  res('Ingresos reales', null, r.ingresos);
  res('Egresos capturados', cuenta(r.movEgresos, 'movimiento', 'movimientos'), r.egresosCapturados);
  if (r.egresosCorregidos > 0) res('Correcciones de captura en egresos', null, -r.egresosCorregidos);
  res('Egresos reales', null, r.egresos);
  res('Resultado', null, r.resultado);

  for (const m of d.meses) {
    const mes = m.periodo.slice(0, 7);
    filas.push(['Mes', 'Ingresos', null, mes, pesos(m.ingresos_centavos), null, null, null, null, null]);
    filas.push(['Mes', 'Egresos', null, mes, pesos(m.egresos_centavos), null, null, null, null, null]);
    if (m.correcciones_centavos !== 0) {
      filas.push(['Mes', 'Correcciones de captura', null, mes, pesos(m.correcciones_centavos), null, null, null, null, null]);
    }
    filas.push(['Mes', 'Saldo final', null, mes, pesos(m.saldo_final_centavos), null, null, null, null, null]);
  }

  for (const [seccion, lista] of [
    ['Ingresos por concepto', d.porConcepto.ingresos],
    ['Egresos por concepto', d.porConcepto.egresos],
  ] as const) {
    for (const c of lista) {
      const det = c.corregido_centavos > 0
        ? `${cuenta(c.movimientos, 'movimiento', 'movimientos')}, capturado ${pesos(c.capturado_centavos)}, corregido ${pesos(c.corregido_centavos)}`
        : cuenta(c.movimientos, 'movimiento', 'movimientos');
      filas.push([seccion, c.concepto_nombre, null, det, pesos(c.neto_centavos), null, null, null, null, null]);
    }
  }

  for (const h of d.porHermano) {
    filas.push(['Ingresos por hermano', 'Total del ejercicio', h.nombre, `Cápitas ${pesos(h.capitas_centavos)}, cuotas ${pesos(h.cuotas_centavos)}, otros ${pesos(h.otros_centavos)}${h.corregido_centavos > 0 ? `, corregido ${pesos(h.corregido_centavos)}` : ''}`, pesos(h.total_centavos), null, null, null, null, null]);
  }

  for (const b of d.porBeneficiario) {
    filas.push(['Egresos por beneficiario', 'Total del ejercicio', b.beneficiario, cuenta(b.movimientos, 'movimiento', 'movimientos'), pesos(b.monto_centavos), null, null, null, null, null]);
  }

  for (const c of d.correcciones) {
    const o = c.origen;
    filas.push([
      'Corrección de captura',
      o ? `Corrige ${o.tipo === 'ingreso' ? 'el ingreso' : 'el egreso'} ${o.folio ?? ''} de ${o.concepto_nombre}`.replace('  ', ' ') : 'Corrige un movimiento de otro ejercicio',
      o ? (o.hermano_nombre ?? o.beneficiario) : null,
      c.ajuste.motivo_ajuste,
      pesos(-c.ajuste.monto_centavos),
      c.ajuste.fecha,
      null,
      NOMBRE_BOLSA[c.ajuste.bolsa],
      null,
      c.ajuste.capturado_por,
    ]);
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
