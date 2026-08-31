/*
 * Ejercicios anuales. El sistema lleva registro de 2026 en adelante.
 */
import { consulta, laFila, unaFila } from '../db';

export interface Ejercicio {
  anio: number;
  fecha_inicio: string;
  fecha_fin: string;
  capita_mensual_centavos: number;
  capita_promocion_centavos: number;
  capita_promocion_dos_centavos: number;
  saldo_apertura_centavos: number;
  apertura_banco_centavos: number;
  apertura_efectivo_centavos: number;
  estado: 'abierto' | 'cerrado';
  notas: string | null;
}

const COLUMNAS = `anio, fecha_inicio, fecha_fin, capita_mensual_centavos,
       capita_promocion_centavos, capita_promocion_dos_centavos, saldo_apertura_centavos, apertura_banco_centavos,
       apertura_efectivo_centavos, estado, notas`;

export const listarEjercicios = (): Promise<Ejercicio[]> =>
  consulta<Ejercicio>(`select ${COLUMNAS} from ejercicio order by anio desc`);

export const obtenerEjercicio = (anio: number): Promise<Ejercicio | null> =>
  unaFila<Ejercicio>(`select ${COLUMNAS} from ejercicio where anio = $1`, [anio]);

/**
 * El ejercicio con el que trabaja la app por omisión: el año en curso si está
 * abierto, si no el abierto más reciente, y si todo está cerrado, el último.
 * Sin la preferencia por el año en curso, abrir 2027 por adelantado en noviembre
 * cambiaría de año toda la aplicación antes de tiempo.
 */
export const ejercicioVigente = (): Promise<Ejercicio> =>
  laFila<Ejercicio>(
    `select ${COLUMNAS} from ejercicio
      order by (estado = 'abierto') desc,
               (anio = extract(year from current_date)::int) desc,
               anio desc
      limit 1`,
  );

/**
 * Año elegido en la barra de direcciones, validado contra los ejercicios que
 * existen. Cualquier valor raro cae en el vigente.
 */
export function anioDeUrl(url: URL, ejercicios: Ejercicio[], vigente: number): number {
  const crudo = url.searchParams.get('anio');
  if (!crudo) return vigente;
  const anio = Number(crudo);
  if (!Number.isInteger(anio)) return vigente;
  return ejercicios.some((e) => e.anio === anio) ? anio : vigente;
}

/** Cortes cerrados por ejercicio, para saber cuáles se pueden cerrar. */
export const cortesCerradosPorAnio = (): Promise<{ anio: number; cerrados: number }[]> =>
  consulta(
    `select e.anio,
            (select count(*)::int from corte_mensual c
              where c.ejercicio_anio = e.anio and c.estado = 'cerrado') as cerrados
       from ejercicio e
      order by e.anio desc`,
  );
