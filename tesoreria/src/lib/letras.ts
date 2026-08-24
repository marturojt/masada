/*
 * Monto en letra para los recibos, al estilo de los documentos formales
 * mexicanos: "MIL QUINIENTOS PESOS 00/100 M.N.".
 *
 * Cubre hasta 999 millones de pesos, que es mucho más de lo que esta caja va a
 * ver. Los compuestos usan la forma apocopada (VEINTIÚN, TREINTA Y UN) porque
 * siempre van seguidos de MIL o de PESOS.
 */

const UNIDADES = [
  '',
  'UN',
  'DOS',
  'TRES',
  'CUATRO',
  'CINCO',
  'SEIS',
  'SIETE',
  'OCHO',
  'NUEVE',
  'DIEZ',
  'ONCE',
  'DOCE',
  'TRECE',
  'CATORCE',
  'QUINCE',
  'DIECISÉIS',
  'DIECISIETE',
  'DIECIOCHO',
  'DIECINUEVE',
  'VEINTE',
  'VEINTIÚN',
  'VEINTIDÓS',
  'VEINTITRÉS',
  'VEINTICUATRO',
  'VEINTICINCO',
  'VEINTISÉIS',
  'VEINTISIETE',
  'VEINTIOCHO',
  'VEINTINUEVE',
];

const DECENAS = [
  '',
  '',
  '',
  'TREINTA',
  'CUARENTA',
  'CINCUENTA',
  'SESENTA',
  'SETENTA',
  'OCHENTA',
  'NOVENTA',
];

const CENTENAS = [
  '',
  'CIENTO',
  'DOSCIENTOS',
  'TRESCIENTOS',
  'CUATROCIENTOS',
  'QUINIENTOS',
  'SEISCIENTOS',
  'SETECIENTOS',
  'OCHOCIENTOS',
  'NOVECIENTOS',
];

/** 0 a 999 en palabras. Cadena vacía para el 0, que se arma en el nivel de arriba. */
function tresCifras(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';

  const centena = Math.floor(n / 100);
  const resto = n % 100;

  const partes: string[] = [];
  if (centena > 0) partes.push(CENTENAS[centena]!);

  if (resto > 0) {
    if (resto < 30) {
      partes.push(UNIDADES[resto]!);
    } else {
      const decena = Math.floor(resto / 10);
      const unidad = resto % 10;
      partes.push(unidad > 0 ? `${DECENAS[decena]} Y ${UNIDADES[unidad]}` : DECENAS[decena]!);
    }
  }

  return partes.join(' ');
}

/** Un entero de pesos en palabras: 1500 se vuelve "MIL QUINIENTOS". */
export function enteroEnLetras(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) {
    throw new Error(`Fuera de rango para escribir en letra: ${String(n)}`);
  }
  if (n === 0) return 'CERO';

  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;

  const partes: string[] = [];

  if (millones > 0) {
    partes.push(millones === 1 ? 'UN MILLÓN' : `${tresCifras(millones)} MILLONES`);
  }
  if (miles > 0) {
    /* "MIL", no "UN MIL": es la forma correcta y la usual en documentos. */
    partes.push(miles === 1 ? 'MIL' : `${tresCifras(miles)} MIL`);
  }
  if (resto > 0) {
    partes.push(tresCifras(resto));
  }

  return partes.join(' ');
}

/** Centavos a la leyenda completa: 150050 da "MIL QUINIENTOS PESOS 50/100 M.N." */
export function montoEnLetras(centavos: number): string {
  if (!Number.isInteger(centavos) || centavos < 0) {
    throw new Error(`Se esperaba un entero de centavos: ${String(centavos)}`);
  }

  const pesos = Math.floor(centavos / 100);
  const fraccion = String(centavos % 100).padStart(2, '0');

  const letras = enteroEnLetras(pesos);
  /* "UN MILLÓN DE PESOS", pero "UN MILLÓN QUINIENTOS MIL PESOS". */
  const conectorDe = letras.endsWith('MILLÓN') || letras.endsWith('MILLONES') ? ' DE' : '';
  const moneda = pesos === 1 ? 'PESO' : 'PESOS';

  return `${letras}${conectorDe} ${moneda} ${fraccion}/100 M.N.`;
}
