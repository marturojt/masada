/*
 * Todo el dinero de este sistema son enteros de centavos. Nunca float, nunca
 * string convertido con Number a medio camino. Este módulo es la única frontera
 * entre esos enteros y lo que lee o escribe una persona.
 */

const formateador = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
});

const formateadorSinSimbolo = new Intl.NumberFormat('es-MX', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 150000 se ve como $1,500.00 */
export const formatoMXN = (centavos: number): string => formateador.format(centavos / 100);

/** 150000 se ve como 1,500.00, para columnas donde el signo de pesos estorba. */
export const formatoCifra = (centavos: number): string =>
  formateadorSinSimbolo.format(centavos / 100);

/** 150000 se vuelve "1500.00", para repoblar un input de monto. */
export const aPesosTexto = (centavos: number): string => (centavos / 100).toFixed(2);

/** Suma defensiva: si algo no es entero, es un bug y debe verse. */
export function sumaCentavos(valores: readonly number[]): number {
  let total = 0;
  for (const v of valores) {
    if (!Number.isInteger(v)) {
      throw new Error(`Se esperaba un entero de centavos y llegó ${String(v)}`);
    }
    total += v;
  }
  return total;
}

/** Convierte a número lo que Postgres devolvió, tolerando null y texto. */
export function centavos(valor: unknown): number {
  if (valor == null) return 0;
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}
