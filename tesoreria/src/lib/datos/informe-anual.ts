/*
 * Informe anual del tesorero: el ejercicio completo, de enero a diciembre.
 *
 * Se lee en tenida igual que el informe mensual, así que tampoco nombra a
 * quienes deben. Las cifras salen de los mismos cortes, para que la suma de
 * los doce informes de tenida dé exactamente este informe.
 */
import { consulta } from '../db';
import { formatoMXN } from '../dinero';
import { nombrePeriodo } from '../fechas';
import type { Clasificacion } from './cortes';
import type { EstadoAplomo } from './gt';

export interface ConceptoAnual {
  tipo: 'ingreso' | 'egreso';
  clasificacion: Clasificacion;
  concepto_nombre: string;
  movimientos: number;
  monto_centavos: number;
}

/** Ingresos y egresos del año por clasificación y concepto, de mayor a menor. */
export const conceptosDelAnio = (anio: number): Promise<ConceptoAnual[]> =>
  consulta<ConceptoAnual>(
    `select m.tipo, c.clasificacion, c.nombre as concepto_nombre,
            count(*)::int as movimientos, sum(m.monto_centavos)::int as monto_centavos
       from movimiento m
       join concepto c on c.id = m.concepto_id
      where m.ejercicio_anio = $1
      group by m.tipo, c.clasificacion, c.nombre
      order by m.tipo, c.clasificacion, sum(m.monto_centavos) desc`,
    [anio],
  );

/** Grupos por clasificación con su subtotal, en el orden en que llegan. */
export function agruparPorClasificacion(
  filas: ConceptoAnual[],
  tipo: 'ingreso' | 'egreso',
): { clasificacion: Clasificacion; total: number; conceptos: ConceptoAnual[] }[] {
  const grupos: { clasificacion: Clasificacion; total: number; conceptos: ConceptoAnual[] }[] = [];
  for (const f of filas.filter((x) => x.tipo === tipo)) {
    let g = grupos.find((x) => x.clasificacion === f.clasificacion);
    if (!g) {
      g = { clasificacion: f.clasificacion, total: 0, conceptos: [] };
      grupos.push(g);
    }
    g.total += f.monto_centavos;
    g.conceptos.push(f);
  }
  return grupos.sort((a, b) => b.total - a.total);
}

export const especieDelAnio = (
  anio: number,
): Promise<{ fecha: string; aportante_nombre: string; descripcion: string; destino: string | null; valor_estimado_centavos: number | null }[]> =>
  consulta(
    `select fecha::text, aportante_nombre, descripcion, destino, valor_estimado_centavos
       from v_aportaciones_especie_periodo
      where extract(year from fecha)::int = $1
      order by fecha, id`,
    [anio],
  );

export interface DatosAnuales {
  anio: number;
  /** Cortes cerrados del ejercicio, de 12. */
  cerrados: number;
  /** true si el ejercicio todavía no termina en el calendario. */
  enCurso: boolean;
  saldoInicial: number;
  ingresos: number;
  egresos: number;
  saldoFinal: number;
  bolsas: { banco: number; efectivo: number } | null;
  mejorMes: { periodo: string; ingresos: number } | null;
  pagadoGT: number;
  capitas: { esperado: number; pagado: number; alCorriente: number; conAdeudo: number; vencido: number };
  aplomo: EstadoAplomo;
}

/** El texto en palabras con que abre el informe anual. */
export function parrafosAnuales(d: DatosAnuales): string[] {
  const p: string[] = [];
  const resultado = d.ingresos - d.egresos;
  const cierre = d.enCurso ? 'al día de hoy cuenta con' : 'lo cerró con';

  p.push(
    `Durante el ejercicio ${d.anio} ingresaron a la tesorería ${formatoMXN(d.ingresos)} y salieron ` +
      `${formatoMXN(d.egresos)}, ` +
      (resultado > 0
        ? `con un resultado a favor de ${formatoMXN(resultado)}. `
        : resultado < 0
          ? `con un resultado en contra de ${formatoMXN(-resultado)}. `
          : 'así que el año quedó parejo. ') +
      `La logia empezó el año con ${formatoMXN(d.saldoInicial)} y ${cierre} ${formatoMXN(d.saldoFinal)}.` +
      (d.bolsas
        ? ` De ese saldo, ${formatoMXN(d.bolsas.banco)} están en el banco y ${formatoMXN(d.bolsas.efectivo)} en efectivo.`
        : ''),
  );

  if (d.mejorMes && d.mejorMes.ingresos > 0) {
    p.push(
      `El mes con más ingresos fue ${nombrePeriodo(d.mejorMes.periodo)}, con ${formatoMXN(d.mejorMes.ingresos)}.` +
        (d.pagadoGT > 0 ? ` A la Gran Tesorería se le pagaron ${formatoMXN(d.pagadoGT)} en el año.` : ''),
    );
  } else if (d.pagadoGT > 0) {
    p.push(`A la Gran Tesorería se le pagaron ${formatoMXN(d.pagadoGT)} en el año.`);
  }

  const c = d.capitas;
  p.push(
    (c.esperado > 0
      ? `De las cápitas del año se esperaban ${formatoMXN(c.esperado)} y se han cobrado ${formatoMXN(c.pagado)}, ` +
        `el ${Math.round((c.pagado / c.esperado) * 100)}%.`
      : 'El ejercicio no tuvo cápitas por cobrar.') +
      (c.conAdeudo === 0
        ? ' Al día de hoy todos los hermanos están al corriente.'
        : ` Al día de hoy, ${c.alCorriente} ${c.alCorriente === 1 ? 'hermano está' : 'hermanos están'} al corriente y ` +
          `${c.conAdeudo} ${c.conAdeudo === 1 ? 'tiene' : 'tienen'} adeudo vencido por ${formatoMXN(c.vencido)}.`),
  );

  const cubierta = d.aplomo.cubierto_hasta
    ? `, con lo ordinario cubierto hasta ${nombrePeriodo(d.aplomo.cubierto_hasta.slice(0, 7))}`
    : '';
  p.push(
    d.aplomo.ordinario_a_plomo
      ? `Con la Gran Tesorería, la logia está a plomo${cubierta}.`
      : `Con la Gran Tesorería, la logia tiene ${d.aplomo.meses_pendientes} ` +
          `${d.aplomo.meses_pendientes === 1 ? 'mes ordinario pendiente' : 'meses ordinarios pendientes'}${cubierta}.`,
  );

  if (d.cerrados < 12) {
    p.push(
      `Este informe es un borrador: hay ${d.cerrados} de 12 cortes cerrados y las cifras pueden cambiar ` +
        'hasta que se cierre diciembre.',
    );
  }
  return p;
}
