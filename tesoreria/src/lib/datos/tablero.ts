/*
 * Cifras del tablero para un periodo: el ejercicio completo o un mes.
 *
 * Los totales son los mismos que el corte mensual (brutos del periodo), para que
 * el tesorero vea en el tablero exactamente lo que después se lee en tenida. Un
 * ajuste se cuenta en el mes en que se registró, con su propio concepto.
 */
import { consulta } from '../db';
import type { CorteCalculado } from './cortes';

/** Lee `?periodo=AAAA-MM` y lo acepta solo si es un mes del ejercicio. */
export function periodoDeUrl(url: URL, anio: number): string | null {
  const crudo = url.searchParams.get('periodo') ?? '';
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(crudo) && crudo.startsWith(`${anio}-`) ? crudo : null;
}

export interface ResumenPeriodo {
  ingresos: number;
  egresos: number;
  resultado: number;
  saldoFinal: number;
  /** "Saldo a hoy" si el periodo sigue en curso, "Saldo al cierre" si ya terminó. */
  etiquetaSaldo: string;
  /** Solo cuando se ve un mes y hay un mes anterior en el ejercicio. */
  anterior: { periodo: string; ingresos: number; egresos: number; resultado: number } | null;
}

const periodoDe = (c: CorteCalculado): string => c.periodo.slice(0, 7);

export function resumenDelPeriodo(
  cortes: CorteCalculado[],
  periodo: string | null,
  hoy: string,
): ResumenPeriodo {
  if (periodo !== null) {
    const i = cortes.findIndex((c) => periodoDe(c) === periodo);
    const c = cortes[i];
    const previo = i > 0 ? cortes[i - 1] : undefined;
    return {
      ingresos: c?.total_ingresos_centavos ?? 0,
      egresos: c?.total_egresos_centavos ?? 0,
      resultado: (c?.total_ingresos_centavos ?? 0) - (c?.total_egresos_centavos ?? 0),
      saldoFinal: c?.saldo_final_centavos ?? 0,
      etiquetaSaldo: periodo >= hoy ? 'Saldo a hoy' : 'Saldo al cierre',
      anterior: previo
        ? {
            periodo: periodoDe(previo),
            ingresos: previo.total_ingresos_centavos,
            egresos: previo.total_egresos_centavos,
            resultado: previo.total_ingresos_centavos - previo.total_egresos_centavos,
          }
        : null,
    };
  }

  const ingresos = cortes.reduce((s, c) => s + c.total_ingresos_centavos, 0);
  const egresos = cortes.reduce((s, c) => s + c.total_egresos_centavos, 0);
  /* El saldo del último mes que ya empezó; en un ejercicio pasado, diciembre. */
  const transcurridos = cortes.filter((c) => periodoDe(c) <= hoy);
  const saldoFinal =
    transcurridos.at(-1)?.saldo_final_centavos ?? cortes[0]?.saldo_inicial_centavos ?? 0;
  const enCurso = cortes.some((c) => periodoDe(c) >= hoy);
  return {
    ingresos,
    egresos,
    resultado: ingresos - egresos,
    saldoFinal,
    etiquetaSaldo: enCurso ? 'Saldo a hoy' : 'Saldo al cierre',
    anterior: null,
  };
}

export interface ConceptoPeriodo {
  tipo: 'ingreso' | 'egreso';
  concepto_id: number;
  concepto_nombre: string;
  movimientos: number;
  monto_centavos: number;
}

/** Ingresos y egresos del periodo por concepto, de mayor a menor. */
export const conceptosDelPeriodo = (
  anio: number,
  periodo: string | null,
): Promise<ConceptoPeriodo[]> =>
  consulta<ConceptoPeriodo>(
    `select m.tipo, c.id as concepto_id, c.nombre as concepto_nombre,
            count(*)::int as movimientos, sum(m.monto_centavos)::int as monto_centavos
       from movimiento m
       join concepto c on c.id = m.concepto_id
      where m.ejercicio_anio = $1
        and ($2::date is null or m.periodo = $2::date)
      group by m.tipo, c.id, c.nombre
      order by m.tipo, sum(m.monto_centavos) desc, c.nombre`,
    [anio, periodo ? `${periodo}-01` : null],
  );
