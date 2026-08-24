/*
 * Piezas de validación reutilizables. Los mensajes van en español porque se
 * muestran tal cual al usuario, nunca los de zod en inglés.
 *
 * Todos los campos pasan primero por comoTexto: un campo ausente en el envío no
 * debe producir un error en inglés sobre tipos, sino el mensaje normal de campo
 * obligatorio o, si es opcional, comportarse como vacío.
 */
import { z } from 'zod';
import type { Grado } from '../tipos';

const comoTexto = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  return String(v);
};

const limpiar = (v: string): string => v.trim().replace(/\s+/g, ' ');

/** Texto obligatorio: recorta, colapsa espacios y limita longitud. */
export const texto = (etiqueta: string, max = 200) =>
  z.preprocess(
    comoTexto,
    z
      .string()
      .transform(limpiar)
      .refine((v) => v.length > 0, `${etiqueta} es obligatorio.`)
      .refine((v) => v.length <= max, `${etiqueta} no debe pasar de ${max} caracteres.`),
  );

/** Texto opcional: vacío o ausente se vuelve undefined. */
export const textoOpcional = (etiqueta: string, max = 200) =>
  z.preprocess(
    comoTexto,
    z
      .string()
      .transform((v) => {
        const limpio = limpiar(v);
        return limpio.length === 0 ? undefined : limpio;
      })
      .refine(
        (v) => v === undefined || v.length <= max,
        `${etiqueta} no debe pasar de ${max} caracteres.`,
      ),
  );

/** Texto largo opcional: conserva saltos de línea. */
export const notas = (max = 4000) =>
  z.preprocess(
    comoTexto,
    z
      .string()
      .transform((v) => {
        const limpio = v.trim();
        return limpio.length === 0 ? undefined : limpio;
      })
      .refine(
        (v) => v === undefined || v.length <= max,
        `Las notas no deben pasar de ${max} caracteres.`,
      ),
  );

/**
 * Monto en pesos capturado por una persona, convertido a centavos enteros.
 * Acepta "1500", "1,500.50", "1500.5", "$1,500". Rechaza más de dos decimales
 * para que nadie pierda un centavo por redondeo silencioso.
 */
export const montoEnCentavos = (
  etiqueta = 'El monto',
  opciones?: { permitirCero?: boolean },
) =>
  z.preprocess(
    comoTexto,
    z
      .string()
      .transform((v) => v.replace(/[\s$,]/g, ''))
      .refine((v) => v.length > 0, `${etiqueta} es obligatorio.`)
      .refine(
        (v) => v.length === 0 || /^\d+(\.\d{1,2})?$/.test(v),
        `${etiqueta} debe ser una cantidad en pesos, con máximo dos decimales.`,
      )
      .transform((v) => {
        const [enteros = '0', decimales = ''] = v.split('.');
        return Number(enteros) * 100 + Number(decimales.padEnd(2, '0'));
      })
      .refine(
        (v) => (opciones?.permitirCero ? v >= 0 : v > 0),
        `${etiqueta} debe ser mayor que cero.`,
      )
      .refine((v) => v <= 100_000_000, `${etiqueta} parece tener ceros de más, revísalo.`),
  );

/** Monto opcional: vacío o ausente se vuelve null. */
export const montoEnCentavosOpcional = (etiqueta = 'El monto') =>
  z.preprocess(
    comoTexto,
    z
      .string()
      .transform((v) => v.replace(/[\s$,]/g, ''))
      .transform((v) => (v.length === 0 ? null : v))
      .refine(
        (v) => v === null || /^\d+(\.\d{1,2})?$/.test(v),
        `${etiqueta} debe ser una cantidad en pesos, con máximo dos decimales.`,
      )
      .transform((v) => {
        if (v === null) return null;
        const [enteros = '0', decimales = ''] = v.split('.');
        return Number(enteros) * 100 + Number(decimales.padEnd(2, '0'));
      })
      .refine((v) => v === null || v > 0, `${etiqueta} debe ser mayor que cero.`)
      .refine(
        (v) => v === null || v <= 100_000_000,
        `${etiqueta} parece tener ceros de más, revísalo.`,
      ),
  );

const esFechaReal = (v: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [a, m, d] = v.split('-').map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(a, m - 1, d));
  return (
    fecha.getUTCFullYear() === a && fecha.getUTCMonth() === m - 1 && fecha.getUTCDate() === d
  );
};

/**
 * Fecha AAAA-MM-DD que se queda como texto. Nunca se convierte a Date: eso
 * desplaza el día según la zona del proceso y termina moviendo un movimiento al
 * mes anterior.
 */
export const fechaISO = (etiqueta = 'La fecha') =>
  z.preprocess(
    comoTexto,
    z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v.length > 0, `${etiqueta} es obligatoria.`)
      .refine((v) => v.length === 0 || esFechaReal(v), `${etiqueta} no es una fecha válida.`),
  );

/** Fecha opcional: vacía o ausente se vuelve undefined. */
export const fechaISOOpcional = (etiqueta = 'La fecha') =>
  z.preprocess(
    comoTexto,
    z
      .string()
      .transform((v) => {
        const limpio = v.trim();
        return limpio.length === 0 ? undefined : limpio;
      })
      .refine(
        (v) => v === undefined || esFechaReal(v),
        `${etiqueta} no es una fecha válida.`,
      ),
  );

/** Periodo mensual AAAA-MM. */
export const periodoISO = (etiqueta = 'El periodo') =>
  z.preprocess(
    comoTexto,
    z
      .string()
      .transform((v) => v.trim())
      .refine(
        (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v),
        `${etiqueta} debe tener formato AAAA-MM.`,
      ),
  );

export const idPositivo = (etiqueta = 'El registro') =>
  z.preprocess(
    comoTexto,
    z
      .string()
      .transform((v) => (v.trim() === '' ? Number.NaN : Number(v)))
      .refine(
        (v) => Number.isInteger(v) && v > 0,
        `${etiqueta} es obligatorio.`,
      ),
  );

/** Id opcional: vacío o ausente se vuelve null. */
export const idOpcional = (etiqueta = 'El registro') =>
  z.preprocess(
    comoTexto,
    z
      .string()
      .transform((v) => (v.trim() === '' ? null : Number(v)))
      .refine(
        (v) => v === null || (Number.isInteger(v) && v > 0),
        `${etiqueta} elegido no es válido.`,
      ),
  );

export const anioEjercicio = z.preprocess(
  comoTexto,
  z
    .string()
    .transform((v) => Number(v))
    .refine(
      (v) => Number.isInteger(v) && v >= 2026 && v <= 2100,
      'El sistema lleva registro de 2026 en adelante.',
    ),
);

export const mes = z.preprocess(
  comoTexto,
  z
    .string()
    .transform((v) => Number(v))
    .refine((v) => Number.isInteger(v) && v >= 1 && v <= 12, 'El mes no es válido.'),
);

export const correo = z.preprocess(
  comoTexto,
  z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .refine((v) => v.length > 0, 'El correo es obligatorio.')
    .refine(
      (v) => v.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'El correo no tiene un formato válido.',
    ),
);

/**
 * Lista cerrada de valores, con mensaje propio cuando llega algo fuera de ella.
 * El tipo de salida se anota a mano porque z.preprocess ensancha el literal del
 * enum a string, y aquí importa conservarlo.
 */
export const opcionDe = <const T extends readonly [string, ...string[]]>(
  valores: T,
  mensaje: string,
): z.ZodType<T[number]> =>
  z.preprocess(comoTexto, z.enum(valores, { error: mensaje })) as unknown as z.ZodType<
    T[number]
  >;

/** Por dónde entra o sale el dinero. */
export const bolsa = opcionDe(['banco', 'efectivo'], 'Elige si fue por banco o en efectivo.');

export const grado: z.ZodType<Grado> = opcionDe(
  ['aprendiz', 'companero', 'maestro'],
  'Elige un grado.',
);

/**
 * Para acciones sin campos, como un botón de confirmar. No valida nada porque no
 * hay nada que validar, pero sigue pasando por las comprobaciones de origen,
 * CSRF y nonce.
 */
export const esquemaVacio = z.object({});
