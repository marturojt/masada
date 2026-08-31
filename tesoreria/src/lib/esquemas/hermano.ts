import { z } from 'zod';
import {
  fechaISO,
  fechaISOOpcional,
  grado,
  idOpcional,
  notas,
  opcionDe,
  texto,
  textoOpcional,
} from './comunes';

/* Fundador ya no se ofrece: en la práctica es un miembro de años anteriores.
   El valor sigue siendo válido en la base para no tocar filas históricas. */
const MOTIVOS_INGRESO = ['iniciacion', 'afiliacion', 'regularizacion'] as const;
export const OPCIONES_MOTIVO_INGRESO = MOTIVOS_INGRESO;
const MOTIVOS_BAJA = [
  'plancha_de_quite',
  'irradiacion',
  'defuncion',
  'traslado',
  'suspension',
  'otro',
] as const;

export const NOMBRE_MOTIVO_INGRESO: Record<string, string> = {
  fundacion: 'Fundador',
  iniciacion: 'Iniciado en la logia',
  afiliacion: 'Afiliado',
  regularizacion: 'Miembro de años anteriores',
};

export const NOMBRE_MOTIVO_BAJA: Record<string, string> = {
  plancha_de_quite: 'Plancha de quite',
  irradiacion: 'Irradiación',
  defuncion: 'Defunción',
  traslado: 'Traslado',
  suspension: 'Suspensión',
  otro: 'Otro',
};

/** Alta y edición comparten forma. El cargo del año va en el mismo formulario. */
export const esquemaHermanoBase = z.object({
  nombre_completo: texto('El nombre completo', 120),
  grado,
  fecha_ingreso: fechaISOOpcional('La fecha de ingreso'),
  motivo_ingreso: opcionDe(MOTIVOS_INGRESO, 'Elige el motivo de ingreso.'),
  fecha_iniciacion: fechaISOOpcional('La fecha de iniciación'),
  fecha_afiliacion: fechaISOOpcional('La fecha de afiliación'),
  correo: textoOpcional('El correo', 120).refine(
    (v) => v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    'El correo no tiene un formato válido.',
  ),
  telefono: textoOpcional('El teléfono', 40),
  notas: notas(2000),
  /** Vacío significa sin cargo. */
  cargo_id: idOpcional('El cargo'),
});

/*
 * La única fecha que se captura es la de ingreso, y ni esa es obligatoria para
 * un miembro de años anteriores: si va en blanco, el sistema pone el 31 de
 * diciembre del año anterior al ejercicio. Para un recién iniciado o un
 * afiliado la fecha de ingreso es el día de su iniciación o afiliación, y las
 * fechas de secretaría se derivan de ahí al guardar.
 */
export const reglasDeMotivo = (
  datos: { motivo_ingreso: string; fecha_ingreso?: string | undefined },
  ctx: z.RefinementCtx,
): void => {
  if (datos.motivo_ingreso !== 'regularizacion' && !datos.fecha_ingreso) {
    ctx.addIssue({
      code: 'custom',
      path: ['fecha_ingreso'],
      message:
        'Para un recién iniciado o un afiliado, la fecha de ingreso es el día de su ' +
        'iniciación o afiliación. Solo un miembro de años anteriores puede ir sin fecha.',
    });
  }
};

export const esquemaHermano = esquemaHermanoBase.superRefine(reglasDeMotivo);

export type DatosFormularioHermano = z.infer<typeof esquemaHermano>;

/** Datos ya completos: la fecha de ingreso resuelta y las de secretaría derivadas. */
export type DatosHermanoCompletos = Omit<DatosFormularioHermano, 'fecha_ingreso'> & {
  fecha_ingreso: string;
};

/*
 * Completa lo que el formulario ya no pide: la fecha de ingreso de un miembro
 * de años anteriores (31 de diciembre del año anterior al ejercicio) y las
 * fechas de iniciación o afiliación, que para un alta nueva son la misma fecha
 * de ingreso. Si ya venían capturadas (edición, carga masiva), se respetan.
 */
export function derivarFechasPorMotivo(
  datos: DatosFormularioHermano,
  anioEjercicio: number,
): DatosHermanoCompletos {
  const fechaIngreso = datos.fecha_ingreso ?? `${anioEjercicio - 1}-12-31`;
  return {
    ...datos,
    fecha_ingreso: fechaIngreso,
    fecha_iniciacion:
      datos.motivo_ingreso === 'iniciacion'
        ? (datos.fecha_iniciacion ?? fechaIngreso)
        : datos.fecha_iniciacion,
    fecha_afiliacion:
      datos.motivo_ingreso === 'afiliacion'
        ? (datos.fecha_afiliacion ?? fechaIngreso)
        : datos.fecha_afiliacion,
  };
}

/** Baja de un hermano. Los adeudos anteriores se conservan. */
export const esquemaBaja = z.object({
  fecha_baja: fechaISO('La fecha de baja'),
  motivo_baja: opcionDe(MOTIVOS_BAJA, 'Elige el motivo de la baja.'),
  notas_baja: notas(1000),
});

/** Evento de grado: aumento de salario o exaltación. */
export const esquemaEventoGrado = z.object({
  tipo_evento: opcionDe(
    ['iniciacion', 'aumento_salario', 'exaltacion', 'afiliacion', 'regularizacion'],
    'Elige el tipo de evento.',
  ),
  fecha: fechaISO('La fecha del evento'),
  grado,
  notas_evento: notas(1000),
});

export const NOMBRE_EVENTO_GRADO: Record<string, string> = {
  iniciacion: 'Iniciación',
  aumento_salario: 'Aumento de salario',
  exaltacion: 'Exaltación',
  afiliacion: 'Afiliación',
  regularizacion: 'Regularización',
};
