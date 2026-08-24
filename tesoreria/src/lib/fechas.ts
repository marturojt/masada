/*
 * Fechas de operación como texto AAAA-MM-DD y periodos como AAAA-MM.
 *
 * Convertir a Date y volver es la forma clásica de que un movimiento del día 1
 * termine contado en el mes anterior, así que aquí las fechas contables viven
 * como texto y solo se formatean para mostrarlas.
 */
import { ZONA } from './config';

const fmtDia = new Intl.DateTimeFormat('es-MX', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const fmtCorta = new Intl.DateTimeFormat('es-MX', {
  timeZone: ZONA,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const fmtLarga = new Intl.DateTimeFormat('es-MX', {
  timeZone: ZONA,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const fmtMomento = new Intl.DateTimeFormat('es-MX', {
  timeZone: ZONA,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

export const MESES_CORTOS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const;

/** Fecha de hoy en la zona de la logia, como AAAA-MM-DD. */
export function hoyISO(): string {
  const partes = fmtDia.formatToParts(new Date());
  const buscar = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${buscar('year')}-${buscar('month')}-${buscar('day')}`;
}

/** Periodo del mes en curso, como AAAA-MM. */
export const periodoActual = (): string => hoyISO().slice(0, 7);

export const anioActual = (): number => Number(hoyISO().slice(0, 4));

export const mesActual = (): number => Number(hoyISO().slice(5, 7));

/** '2026-08-15' se vuelve '2026-08'. */
export const periodoDe = (fechaISO: string): string => fechaISO.slice(0, 7);

/** '2026-08' se vuelve '2026-08-01'. */
export const primerDiaDe = (periodo: string): string => `${periodo}-01`;

/** '2026-08' se vuelve 'agosto 2026'. */
export function nombrePeriodo(periodo: string): string {
  const anio = periodo.slice(0, 4);
  const mes = Number(periodo.slice(5, 7));
  return `${MESES[mes - 1] ?? '?'} ${anio}`;
}

/** '2026-08' se vuelve 'ago 2026'. */
export function nombrePeriodoCorto(periodo: string): string {
  const anio = periodo.slice(0, 4);
  const mes = Number(periodo.slice(5, 7));
  return `${MESES_CORTOS[mes - 1] ?? '?'} ${anio}`;
}

export const nombreMes = (mes: number): string => MESES[mes - 1] ?? '?';

/** Los doce periodos de un ejercicio, en orden. */
export const periodosDelAnio = (anio: number): string[] =>
  Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, '0')}`);

/**
 * Fecha de operación formateada. Se interpreta a mediodía UTC para que el
 * formateo con zona no la corra un día hacia atrás.
 */
function comoFecha(fechaISO: string): Date {
  return new Date(`${fechaISO}T12:00:00Z`);
}

export const formatoFechaCorta = (fechaISO: string): string =>
  fmtCorta.format(comoFecha(fechaISO));

export const formatoFechaLarga = (fechaISO: string): string =>
  fmtLarga.format(comoFecha(fechaISO));

/** Para timestamps de auditoría, que sí son momentos y no fechas contables. */
export const formatoMomento = (momento: Date | string): string =>
  fmtMomento.format(typeof momento === 'string' ? new Date(momento) : momento);

/** Periodo anterior a uno dado, sin salirse del calendario. */
export function periodoAnterior(periodo: string): string {
  const anio = Number(periodo.slice(0, 4));
  const mes = Number(periodo.slice(5, 7));
  return mes === 1
    ? `${anio - 1}-12`
    : `${anio}-${String(mes - 1).padStart(2, '0')}`;
}

export function periodoSiguiente(periodo: string): string {
  const anio = Number(periodo.slice(0, 4));
  const mes = Number(periodo.slice(5, 7));
  return mes === 12
    ? `${anio + 1}-01`
    : `${anio}-${String(mes + 1).padStart(2, '0')}`;
}
