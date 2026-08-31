/*
 * Carga masiva por CSV: hermanos, ingresos y egresos.
 *
 * La regla de oro: la carga pasa POR ENCIMA de las mismas reglas que la captura
 * manual, nunca por debajo. Cada fila se valida con los mismos esquemas de zod,
 * los conceptos se resuelven por su clave contra el catálogo, los pagos de
 * cápita se aplican con el mismo FIFO, y los egresos nacen REGISTRADOS: las dos
 * firmas y el comprobante de la entrega siguen siendo manuales, a propósito.
 *
 * Primero se ensaya (analizar), y aplicar vuelve a validar todo dentro de UNA
 * transacción: o entra la carga completa o no entra nada.
 */
import { registrarEn } from '../bitacora';
import { consumirNonce } from '../csrf';
import { analizarCSV } from '../csv';
import { enTransaccion, type Tx } from '../db';
import { aplicarACargo, cargosConSaldo } from '../datos/capitas';
import { conceptoPorClave, type Concepto } from '../datos/conceptos';
import { insertarEgreso } from '../datos/egresos';
import {
  actualizarHermano,
  hermanosActivos,
  insertarHermano,
  obtenerHermano,
  registrarEventoGrado,
} from '../datos/hermanos';
import { eventoInicial } from './hermanos';
import { insertarMovimiento } from '../datos/movimientos';
import { formatoMXN } from '../dinero';
import { ErrorDeNegocio } from '../errores';
import {
  derivarFechasPorMotivo,
  esquemaHermanoBase,
  reglasDeMotivo,
  type DatosHermanoCompletos,
} from '../esquemas/hermano';
import { ejercicioVigente } from '../datos/ejercicios';
import type { Sesion } from '../sesion';
import { z } from 'zod';
import {
  bolsa as esquemaBolsa,
  fechaISO,
  fechaISOOpcional,
  montoEnCentavos,
  notas,
  texto,
  textoOpcional,
} from '../esquemas/comunes';

interface Contexto {
  sesion: Sesion;
  nonce: string;
  idPeticion: string;
}

export type TipoImportacion = 'hermanos' | 'ingresos' | 'egresos';

export interface FilaEnsayo {
  linea: number;
  resumen: string;
  error: string | null;
}

export interface Ensayo {
  tipo: TipoImportacion;
  total: number;
  validas: number;
  filas: FilaEnsayo[];
}

/* ── Esquemas de fila. Los montos vienen en pesos, como en la interfaz. ────── */

const esquemaFilaIngreso = z.object({
  fecha: fechaISO('La fecha'),
  concepto: texto('La clave del concepto', 60),
  bolsa: esquemaBolsa,
  monto: montoEnCentavos('El monto'),
  hermano: textoOpcional('El hermano', 150),
  descripcion: textoOpcional('La descripción', 300),
});

const esquemaFilaEgreso = z.object({
  fecha: fechaISO('La fecha'),
  concepto: texto('La clave del concepto', 60),
  beneficiario: texto('El beneficiario', 150),
  monto: montoEnCentavos('El monto'),
  descripcion: texto('La descripción', 400),
  por_comprobar: textoOpcional('Por comprobar', 10),
  hermano: textoOpcional('El hermano', 150),
  notas: notas(1000),
});

/* ── Resolución de referencias por texto ───────────────────────────────────── */

function primerError(resultado: z.ZodSafeParseError<unknown>): string {
  const issue = resultado.error.issues[0];
  return issue ? `${issue.path.join('.') || 'fila'}: ${issue.message}` : 'Fila no válida.';
}

const esSi = (v: string | undefined): boolean =>
  v !== undefined && ['si', 'sí', 'x', 'true', '1'].includes(v.toLowerCase());

/** Mapa nombre normalizado → id, para referir hermanos por su nombre. */
async function mapaDeHermanos(): Promise<Map<string, number>> {
  const lista = await hermanosActivos();
  const mapa = new Map<string, number>();
  for (const h of lista) mapa.set(normalizar(h.nombre_completo), h.id);
  return mapa;
}

const normalizar = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function resolverHermano(
  mapa: Map<string, number>,
  referencia: string | undefined,
): number | null {
  if (!referencia) return null;
  if (/^\d+$/.test(referencia)) return Number(referencia);
  const id = mapa.get(normalizar(referencia));
  if (id === undefined) {
    throw new ErrorDeNegocio(
      `El hermano "${referencia}" no está en el padrón activo. Usa el nombre completo ` +
        'exacto o su id (columna id de la plantilla de hermanos).',
    );
  }
  return id;
}

async function conceptoDeClave(
  cache: Map<string, Concepto | null>,
  clave: string,
  naturaleza: 'ingreso' | 'egreso',
): Promise<Concepto> {
  if (!cache.has(clave)) cache.set(clave, await conceptoPorClave(clave));
  const concepto = cache.get(clave) ?? null;
  if (!concepto || !concepto.activo) {
    throw new ErrorDeNegocio(`No hay un concepto activo con la clave "${clave}".`);
  }
  if (concepto.naturaleza !== naturaleza) {
    throw new ErrorDeNegocio(
      `El concepto "${clave}" es de ${concepto.naturaleza}, no de ${naturaleza}.`,
    );
  }
  if (naturaleza === 'egreso' && concepto.tipo_especial === 'gran_tesoreria') {
    throw new ErrorDeNegocio(
      'Los pagos a la Gran Tesorería no van por carga masiva: se capturan como ' +
        'obligaciones en su módulo y de ahí se genera el egreso.',
    );
  }
  if (naturaleza === 'ingreso' && !concepto.seleccionable && concepto.tipo_especial !== 'capita') {
    throw new ErrorDeNegocio(`El concepto "${clave}" lo maneja el sistema por su cuenta.`);
  }
  return concepto;
}

/* ── Análisis y aplicación por tipo ────────────────────────────────────────── */

const esquemaFechasGrado = z.object({
  fecha_aumento_salario: fechaISOOpcional('La fecha de aumento de salario'),
  fecha_exaltacion: fechaISOOpcional('La fecha de exaltación'),
});

interface PlanHermano {
  linea: number;
  id: number | null;
  datos: DatosHermanoCompletos;
  fechasGrado: z.infer<typeof esquemaFechasGrado>;
}

async function planearHermanos(csv: string): Promise<{ plan: PlanHermano[]; ensayo: Ensayo }> {
  const ejercicio = await ejercicioVigente();
  const { encabezados, filas } = analizarCSV(csv);
  const requeridos = ['nombre_completo', 'grado', 'fecha_ingreso', 'motivo_ingreso'];
  const faltan = requeridos.filter((c) => !encabezados.includes(c));
  if (filas.length === 0) throw new ErrorDeNegocio('El archivo no trae filas de datos.');
  if (faltan.length > 0) {
    throw new ErrorDeNegocio(
      `Al CSV le faltan columnas: ${faltan.join(', ')}. Descarga la plantilla de nuevo.`,
    );
  }

  const plan: PlanHermano[] = [];
  const resultado: FilaEnsayo[] = [];
  const nombresVistos = new Set<string>();

  for (const fila of filas) {
    const v = fila.valores;
    const id = v.id && /^\d+$/.test(v.id) ? Number(v.id) : null;
    try {
      if (v.id && id === null) throw new ErrorDeNegocio(`El id "${v.id}" no es un número.`);

      /* En una actualización, las celdas vacías conservan lo que ya está. */
      let base: Record<string, string | undefined> = {};
      if (id !== null) {
        const actual = await obtenerHermano(id);
        if (!actual) throw new ErrorDeNegocio(`No hay hermano con id ${id}.`);
        base = {
          nombre_completo: actual.nombre_completo,
          grado: actual.grado,
          fecha_ingreso: actual.fecha_ingreso,
          motivo_ingreso: actual.motivo_ingreso,
          fecha_iniciacion: actual.fecha_iniciacion ?? undefined,
          fecha_afiliacion: actual.fecha_afiliacion ?? undefined,
          correo: actual.correo ?? undefined,
          telefono: actual.telefono ?? undefined,
          notas: actual.notas ?? undefined,
        };
      }
      const combinado: Record<string, string | undefined> = { ...base };
      for (const campo of Object.keys(v)) {
        if (campo !== 'id' && v[campo] !== '') combinado[campo] = v[campo];
      }

      const parseo = esquemaHermanoBase.omit({ cargo_id: true }).superRefine(reglasDeMotivo).safeParse(combinado);
      if (!parseo.success) throw new ErrorDeNegocio(primerError(parseo));
      const fechasGrado = esquemaFechasGrado.safeParse(v);
      if (!fechasGrado.success) throw new ErrorDeNegocio(primerError(fechasGrado));

      const clave = normalizar(parseo.data.nombre_completo);
      if (nombresVistos.has(clave)) {
        throw new ErrorDeNegocio(`"${parseo.data.nombre_completo}" aparece dos veces en el archivo.`);
      }
      nombresVistos.add(clave);

      plan.push({
        linea: fila.linea,
        id,
        datos: derivarFechasPorMotivo({ ...parseo.data, cargo_id: null }, ejercicio.anio),
        fechasGrado: fechasGrado.data,
      });
      resultado.push({
        linea: fila.linea,
        resumen: `${id === null ? 'Alta' : `Actualiza id ${id}`}: ${parseo.data.nombre_completo}`,
        error: null,
      });
    } catch (error) {
      if (!(error instanceof ErrorDeNegocio)) throw error;
      resultado.push({ linea: fila.linea, resumen: v.nombre_completo ?? '', error: error.message });
    }
  }

  return {
    plan,
    ensayo: {
      tipo: 'hermanos',
      total: resultado.length,
      validas: resultado.filter((f) => f.error === null).length,
      filas: resultado,
    },
  };
}

interface PlanIngreso {
  linea: number;
  datos: z.infer<typeof esquemaFilaIngreso>;
  concepto: Concepto;
  hermanoId: number | null;
}

async function planearIngresos(csv: string): Promise<{ plan: PlanIngreso[]; ensayo: Ensayo }> {
  const { encabezados, filas } = analizarCSV(csv);
  const requeridos = ['fecha', 'concepto', 'bolsa', 'monto'];
  const faltan = requeridos.filter((c) => !encabezados.includes(c));
  if (filas.length === 0) throw new ErrorDeNegocio('El archivo no trae filas de datos.');
  if (faltan.length > 0) {
    throw new ErrorDeNegocio(
      `Al CSV le faltan columnas: ${faltan.join(', ')}. Descarga la plantilla de nuevo.`,
    );
  }

  const mapa = await mapaDeHermanos();
  const cache = new Map<string, Concepto | null>();
  const plan: PlanIngreso[] = [];
  const resultado: FilaEnsayo[] = [];

  for (const fila of filas) {
    const v = fila.valores;
    try {
      const parseo = esquemaFilaIngreso.safeParse(v);
      if (!parseo.success) throw new ErrorDeNegocio(primerError(parseo));

      const concepto = await conceptoDeClave(cache, parseo.data.concepto, 'ingreso');
      const hermanoId = resolverHermano(mapa, parseo.data.hermano);
      if (concepto.requiere_hermano && hermanoId === null) {
        throw new ErrorDeNegocio(`Para "${concepto.nombre}" hay que indicar el hermano.`);
      }
      if (concepto.tipo_especial === 'capita' && hermanoId === null) {
        throw new ErrorDeNegocio('Un pago de cápita siempre es de un hermano.');
      }

      plan.push({ linea: fila.linea, datos: parseo.data, concepto, hermanoId });
      resultado.push({
        linea: fila.linea,
        resumen: `${parseo.data.fecha} · ${concepto.nombre} · ${formatoMXN(parseo.data.monto)}${
          parseo.data.hermano ? ` · ${parseo.data.hermano}` : ''
        }`,
        error: null,
      });
    } catch (error) {
      if (!(error instanceof ErrorDeNegocio)) throw error;
      resultado.push({
        linea: fila.linea,
        resumen: `${v.fecha ?? ''} ${v.concepto ?? ''} ${v.monto ?? ''}`.trim(),
        error: error.message,
      });
    }
  }

  return {
    plan,
    ensayo: {
      tipo: 'ingresos',
      total: resultado.length,
      validas: resultado.filter((f) => f.error === null).length,
      filas: resultado,
    },
  };
}

interface PlanEgreso {
  linea: number;
  datos: z.infer<typeof esquemaFilaEgreso>;
  concepto: Concepto;
  hermanoId: number | null;
  porComprobar: boolean;
}

async function planearEgresos(csv: string): Promise<{ plan: PlanEgreso[]; ensayo: Ensayo }> {
  const { encabezados, filas } = analizarCSV(csv);
  const requeridos = ['fecha', 'concepto', 'beneficiario', 'monto', 'descripcion'];
  const faltan = requeridos.filter((c) => !encabezados.includes(c));
  if (filas.length === 0) throw new ErrorDeNegocio('El archivo no trae filas de datos.');
  if (faltan.length > 0) {
    throw new ErrorDeNegocio(
      `Al CSV le faltan columnas: ${faltan.join(', ')}. Descarga la plantilla de nuevo.`,
    );
  }

  const mapa = await mapaDeHermanos();
  const cache = new Map<string, Concepto | null>();
  const plan: PlanEgreso[] = [];
  const resultado: FilaEnsayo[] = [];

  for (const fila of filas) {
    const v = fila.valores;
    try {
      const parseo = esquemaFilaEgreso.safeParse(v);
      if (!parseo.success) throw new ErrorDeNegocio(primerError(parseo));

      const concepto = await conceptoDeClave(cache, parseo.data.concepto, 'egreso');
      const hermanoId = resolverHermano(mapa, parseo.data.hermano);
      if (concepto.requiere_hermano && hermanoId === null) {
        throw new ErrorDeNegocio(`Para "${concepto.nombre}" hay que indicar el hermano.`);
      }

      plan.push({
        linea: fila.linea,
        datos: parseo.data,
        concepto,
        hermanoId,
        porComprobar: esSi(parseo.data.por_comprobar),
      });
      resultado.push({
        linea: fila.linea,
        resumen: `${parseo.data.fecha} · ${concepto.nombre} · ${parseo.data.beneficiario} · ${formatoMXN(parseo.data.monto)}`,
        error: null,
      });
    } catch (error) {
      if (!(error instanceof ErrorDeNegocio)) throw error;
      resultado.push({
        linea: fila.linea,
        resumen: `${v.fecha ?? ''} ${v.concepto ?? ''} ${v.monto ?? ''}`.trim(),
        error: error.message,
      });
    }
  }

  return {
    plan,
    ensayo: {
      tipo: 'egresos',
      total: resultado.length,
      validas: resultado.filter((f) => f.error === null).length,
      filas: resultado,
    },
  };
}

/** El ensayo: valida todo y cuenta, sin escribir nada. */
export async function ensayarImportacion(tipo: TipoImportacion, csv: string): Promise<Ensayo> {
  if (tipo === 'hermanos') return (await planearHermanos(csv)).ensayo;
  if (tipo === 'ingresos') return (await planearIngresos(csv)).ensayo;
  return (await planearEgresos(csv)).ensayo;
}

/**
 * Aplica la carga completa en una sola transacción. Si alguna fila no pasa,
 * no entra ninguna: se corrige el archivo y se vuelve a subir.
 */
export async function aplicarImportacion(
  ctx: Contexto,
  tipo: TipoImportacion,
  csv: string,
): Promise<{ aplicadas: number; detalle: string }> {
  const usuarioId = ctx.sesion.usuario.id;

  if (tipo === 'hermanos') {
    const { plan, ensayo } = await planearHermanos(csv);
    exigirTodoValido(ensayo);
    return enTransaccion(async (tx) => {
      await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'importar');
      let altas = 0;
      let cambios = 0;
      for (const fila of plan) {
        let hermanoId: number;
        if (fila.id === null) {
          hermanoId = await insertarHermano(tx, fila.datos, usuarioId);
          /* El mismo evento inicial que el alta manual. */
          await registrarEventoGrado(tx, hermanoId, eventoInicial(fila.datos), usuarioId);
          altas++;
        } else {
          hermanoId = fila.id;
          await actualizarHermano(tx, hermanoId, fila.datos);
          cambios++;
        }
        await completarHistorialDeGrados(tx, hermanoId, fila, usuarioId);
      }
      const detalle = `${altas} alta(s) y ${cambios} actualización(es) de hermanos`;
      await bitacoraImportacion(tx, ctx, tipo, plan.length, detalle);
      return { aplicadas: plan.length, detalle };
    }, usuarioId);
  }

  if (tipo === 'ingresos') {
    const { plan, ensayo } = await planearIngresos(csv);
    exigirTodoValido(ensayo);
    return enTransaccion(async (tx) => {
      await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'importar');
      let total = 0;
      for (const fila of plan) {
        const movimientoId = await insertarMovimiento(
          tx,
          {
            fecha: fila.datos.fecha,
            tipo: 'ingreso',
            bolsa: fila.datos.bolsa,
            conceptoId: fila.concepto.id,
            montoCentavos: fila.datos.monto,
            descripcion:
              fila.datos.descripcion ??
              `${fila.concepto.nombre}${fila.datos.hermano ? ` de ${fila.datos.hermano}` : ''}`,
            hermanoId: fila.hermanoId,
            archivoId: null,
          },
          usuarioId,
        );
        /* Cápitas: el mismo FIFO del módulo, del mes más antiguo con saldo. */
        if (fila.concepto.tipo_especial === 'capita' && fila.hermanoId !== null) {
          const anio = Number(fila.datos.fecha.slice(0, 4));
          const pendientes = await cargosConSaldo(tx, fila.hermanoId, anio);
          if (pendientes.length === 0) {
            const plan_ = await tx.unaFila<{ id: number }>(
              'select id from capita_plan where hermano_id = $1 and ejercicio_anio = $2 and vigente',
              [fila.hermanoId, anio],
            );
            if (!plan_) {
              throw new ErrorDeNegocio(
                `Línea ${fila.linea}: ${fila.datos.hermano} no tiene modalidad de cápita ` +
                  `asignada para ${anio}. Asígnala primero en Cápitas.`,
              );
            }
          }
          let restante = fila.datos.monto;
          for (const cargo of pendientes) {
            if (restante <= 0) break;
            const aplica = Math.min(restante, cargo.saldo_centavos);
            await aplicarACargo(tx, movimientoId, cargo.capita_cargo_id, aplica, usuarioId);
            restante -= aplica;
          }
        }
        total += fila.datos.monto;
      }
      const detalle = `${plan.length} ingreso(s) por ${formatoMXN(total)}`;
      await bitacoraImportacion(tx, ctx, tipo, plan.length, detalle);
      return { aplicadas: plan.length, detalle };
    }, usuarioId);
  }

  const { plan, ensayo } = await planearEgresos(csv);
  exigirTodoValido(ensayo);
  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'importar');
    let total = 0;
    for (const fila of plan) {
      await insertarEgreso(
        tx,
        {
          fecha_solicitud: fila.datos.fecha,
          concepto_id: fila.concepto.id,
          beneficiario: fila.datos.beneficiario,
          descripcion: fila.datos.descripcion,
          hermano_id: fila.hermanoId,
          monto_solicitado_centavos: fila.datos.monto,
          requiere_comprobacion: fila.porComprobar,
          notas: fila.datos.notas,
        },
        usuarioId,
      );
      total += fila.datos.monto;
    }
    const detalle =
      `${plan.length} egreso(s) por ${formatoMXN(total)}, todos en estado registrado: ` +
      'faltan las dos firmas y la entrega con comprobante, que siguen siendo manuales';
    await bitacoraImportacion(tx, ctx, tipo, plan.length, detalle);
    return { aplicadas: plan.length, detalle };
  }, usuarioId);
}

/*
 * Completa el historial de grados con las fechas que trae el CSV. Solo agrega
 * el evento si el hermano no tiene ninguno de ese tipo: corregir una fecha ya
 * capturada se hace en su ficha, donde se ve el historial completo. Y nunca se
 * recalcula el grado vigente desde aquí: un maestro al que solo se le llenó la
 * fecha de iniciación seguiría siendo maestro.
 */
async function completarHistorialDeGrados(
  tx: Tx,
  hermanoId: number,
  fila: PlanHermano,
  usuarioId: number,
): Promise<void> {
  const eventos: { tipo: string; fecha: string | undefined; grado: 'aprendiz' | 'companero' | 'maestro' }[] = [
    { tipo: 'iniciacion', fecha: fila.datos.fecha_iniciacion, grado: 'aprendiz' },
    { tipo: 'aumento_salario', fecha: fila.fechasGrado.fecha_aumento_salario, grado: 'companero' },
    { tipo: 'exaltacion', fecha: fila.fechasGrado.fecha_exaltacion, grado: 'maestro' },
  ];
  for (const evento of eventos) {
    if (!evento.fecha) continue;
    const existente = await tx.unaFila<{ id: number }>(
      'select id from hermano_grado where hermano_id = $1 and tipo_evento = $2 limit 1',
      [hermanoId, evento.tipo],
    );
    if (existente) continue;
    await registrarEventoGrado(
      tx,
      hermanoId,
      {
        grado: evento.grado,
        fecha: evento.fecha,
        tipoEvento: evento.tipo,
        notas: 'Capturado por carga masiva',
      },
      usuarioId,
    );
  }
}

function exigirTodoValido(ensayo: Ensayo): void {
  if (ensayo.validas !== ensayo.total) {
    const primera = ensayo.filas.find((f) => f.error !== null);
    throw new ErrorDeNegocio(
      `El archivo tiene ${ensayo.total - ensayo.validas} fila(s) con error y no se aplicó nada. ` +
        `La primera: línea ${primera?.linea}, ${primera?.error}`,
    );
  }
  if (ensayo.total === 0) throw new ErrorDeNegocio('El archivo no trae filas de datos.');
}

async function bitacoraImportacion(
  tx: Tx,
  ctx: Contexto,
  tipo: TipoImportacion,
  filas: number,
  detalle: string,
): Promise<void> {
  await registrarEn(tx, {
    usuarioId: ctx.sesion.usuario.id,
    idPeticion: ctx.idPeticion,
    accion: 'importacion_csv',
    entidad: 'importacion',
    entidadId: null,
    detalle: { tipo, filas, detalle },
  });
}
