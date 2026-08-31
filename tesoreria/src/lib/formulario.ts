/*
 * Procesamiento de formularios HTML clásicos.
 *
 * Las mutaciones son POST a la propia página con redirect 303 al terminar
 * (patrón PRG). Así los errores de validación se pintan inline en el mismo
 * render, sin cookies de resultado, y todo funciona con JavaScript desactivado.
 *
 * El trabajo va en dos pasos, porque una página puede atender varias acciones y
 * el cuerpo de la petición solo se puede leer una vez:
 *
 *   leerFormulario  método, content-type, origen, tamaño y FormData
 *   validar         token CSRF, nonce vigente y esquema de zod
 *
 * procesarFormulario hace los dos de un tirón, que es el caso común.
 */
import type { z } from 'zod';
import { config, esProduccion } from './config';
import { CAMPO_CSRF, CAMPO_NONCE, nonceVigente, tokensIguales } from './csrf';
import type { Sesion } from './sesion';

const TIPOS_ACEPTADOS = ['application/x-www-form-urlencoded', 'multipart/form-data'];

/*
 * En local, 127.0.0.1 y localhost son la misma máquina pero orígenes distintos
 * para el navegador. Se aceptan los dos para que entrar por cualquiera funcione.
 * En producción solo vale el origen exacto del .env.
 */
const ORIGENES_PERMITIDOS = new Set([config.TS_ORIGEN]);
if (!esProduccion) {
  ORIGENES_PERMITIDOS.add(config.TS_ORIGEN.replace('//127.0.0.1', '//localhost'));
  ORIGENES_PERMITIDOS.add(config.TS_ORIGEN.replace('//localhost', '//127.0.0.1'));
}

export interface Fallo {
  ok: false;
  estado: number;
  /** Errores por nombre de campo. La clave _general es para el formulario entero. */
  errores: Record<string, string>;
  /** Lo que el usuario escribió, para repoblar el formulario. Sin contraseñas. */
  valores: Record<string, string>;
}

export interface Entrada {
  ok: true;
  /** Campos de texto tal como llegaron. */
  crudos: Record<string, string>;
  /** Archivos subidos, por nombre de campo. */
  archivos: Record<string, File>;
  /** Copia de crudos sin secretos, para repoblar el formulario. */
  valores: Record<string, string>;
  /** Valor del campo oculto _accion, cuando la página atiende varias. */
  accion: string | null;
}

export interface Exito<T> {
  ok: true;
  datos: T;
  archivos: Record<string, File>;
  /**
   * Lo que el usuario escribió. Sirve para repoblar el formulario cuando el caso
   * de uso rechaza los datos por una regla de negocio, no por validación.
   */
  valores: Record<string, string>;
  /** Token que el caso de uso debe consumir dentro de su transacción. */
  nonce: string;
}

export type Resultado<T> = Exito<T> | Fallo;

const fallo = (
  estado: number,
  errores: Record<string, string>,
  valores: Record<string, string> = {},
): Fallo => ({ ok: false, estado, errores, valores });

/** Campos que nunca se devuelven para repoblar el formulario. */
const esSecreto = (campo: string): boolean =>
  campo.startsWith('contrasena') || campo === CAMPO_CSRF || campo === CAMPO_NONCE;

/** Paso 1: comprobaciones de transporte y lectura del cuerpo. */
export async function leerFormulario(ctx: { request: Request }): Promise<Entrada | Fallo> {
  const { request } = ctx;

  if (request.method !== 'POST') {
    return fallo(405, { _general: 'Método no permitido.' });
  }

  const tipo = request.headers.get('content-type') ?? '';
  if (!TIPOS_ACEPTADOS.some((t) => tipo.includes(t))) {
    return fallo(415, { _general: 'Tipo de contenido no permitido.' });
  }

  /*
   * Se compara contra TS_ORIGEN del .env y no contra url.origin, porque
   * url.origin se deriva de cabeceras que puede poner un intermediario.
   */
  const origen = request.headers.get('origin');
  if (!origen || !ORIGENES_PERMITIDOS.has(origen)) {
    return fallo(403, {
      _general: 'La petición no viene de este sitio. Vuelve a cargar la página.',
    });
  }

  const sitio = request.headers.get('sec-fetch-site');
  if (sitio && sitio !== 'same-origin') {
    return fallo(403, {
      _general: 'La petición no viene de este sitio. Vuelve a cargar la página.',
    });
  }

  /* Se rechaza por tamaño declarado antes de gastar memoria leyendo el cuerpo. */
  const largo = Number(request.headers.get('content-length') ?? '0');
  if (largo > config.TS_MAX_SUBIDA_BYTES) {
    const mb = Math.floor(config.TS_MAX_SUBIDA_BYTES / (1024 * 1024));
    return fallo(413, {
      _general: `El envío pasa de ${mb} MB. Si es una foto, súbela más pequeña.`,
    });
  }

  let datosFormulario: FormData;
  try {
    datosFormulario = await request.formData();
  } catch {
    return fallo(400, { _general: 'No se pudo leer el formulario. Inténtalo de nuevo.' });
  }

  const crudos: Record<string, string> = {};
  const archivos: Record<string, File> = {};
  for (const [clave, valor] of datosFormulario.entries()) {
    if (typeof valor === 'string') crudos[clave] = valor;
    else if (valor.size > 0 || valor.name !== '') archivos[clave] = valor;
  }

  const valores: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(crudos)) {
    if (!esSecreto(clave)) valores[clave] = valor;
  }

  return { ok: true, crudos, archivos, valores, accion: crudos._accion ?? null };
}

export interface OpcionesValidacion<T> {
  esquema: z.ZodType<T>;
  /** Identifica el formulario. Un nonce de un formulario no sirve en otro. */
  proposito: string;
  /**
   * Sesión dueña del formulario. Solo /entrar pasa null, porque ahí todavía no
   * hay sesión de la cual colgar el token. El acceso se protege con la
   * comprobación de origen y con el límite de intentos.
   */
  sesion: Sesion | null;
}

/** Paso 2: CSRF, nonce y esquema. */
export async function validar<T>(
  entrada: Entrada,
  opciones: OpcionesValidacion<T>,
): Promise<Resultado<T>> {
  const { sesion, proposito } = opciones;
  const { crudos, valores, archivos } = entrada;

  if (sesion) {
    const csrf = crudos[CAMPO_CSRF] ?? '';
    if (!csrf || !tokensIguales(csrf, sesion.csrfToken)) {
      return fallo(
        403,
        { _general: 'La sesión cambió mientras llenabas el formulario. Vuelve a cargarlo.' },
        valores,
      );
    }

    const nonce = crudos[CAMPO_NONCE] ?? '';
    if (!nonce || !(await nonceVigente(nonce, sesion.idHash, proposito))) {
      return fallo(
        409,
        {
          _general:
            'Este formulario ya fue enviado o expiró. Vuelve a cargarlo para no ' +
            'duplicar el registro.',
        },
        valores,
      );
    }
  }

  const analisis = opciones.esquema.safeParse(crudos);
  if (!analisis.success) {
    const errores: Record<string, string> = {};
    for (const problema of analisis.error.issues) {
      const campo = problema.path.length > 0 ? String(problema.path[0]) : '_general';
      errores[campo] ??= problema.message;
    }
    return fallo(422, errores, valores);
  }

  return {
    ok: true,
    datos: analisis.data,
    archivos,
    valores,
    nonce: crudos[CAMPO_NONCE] ?? '',
  };
}

/** Los dos pasos juntos, para las páginas con una sola acción. */
export async function procesarFormulario<T>(
  ctx: { request: Request },
  opciones: OpcionesValidacion<T>,
): Promise<Resultado<T>> {
  const entrada = await leerFormulario(ctx);
  if (!entrada.ok) return entrada;
  return validar(entrada, opciones);
}

/** Mensajes de éxito. Nunca se imprime en el HTML lo que venga en la query. */
const AVISOS: Record<string, string> = {
  pago: 'Pago registrado.',
  hermano: 'Cambios guardados.',
  modalidad: 'Modalidad de cápita asignada.',
  ingreso: 'Ingreso registrado.',
  egreso: 'Egreso registrado.',
  firma: 'Firma registrada.',
  comprobacion: 'Comprobación registrada.',
  concepto: 'Concepto guardado.',
  corte: 'Corte cerrado.',
  ejercicio: 'Ejercicio actualizado.',
  contrasena: 'Contraseña actualizada.',
  exportado: 'Cuadro exportado al sitio público.',
  obligacion: 'Obligación capturada.',
  detalle: 'Renglón de detalle agregado.',
  cancelada: 'Obligación cancelada.',
  membresia: 'Membresía registrada.',
  renglon: 'Renglón agregado a la membresía.',
  ligado: 'Renglón conciliado con el padrón.',
  tarifa: 'Tarifa capturada.',
  aportacion: 'Aportación registrada.',
  registro: 'Registro externo actualizado.',
  usuario: 'Usuario guardado.',
};

export const avisoDe = (clave: string | null): string | null =>
  clave ? (AVISOS[clave] ?? null) : null;
