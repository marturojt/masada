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

const MOTIVOS_INGRESO = ['fundacion', 'iniciacion', 'afiliacion', 'regularizacion'] as const;
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
export const esquemaHermano = z.object({
  nombre_completo: texto('El nombre completo', 120),
  grado,
  fecha_ingreso: fechaISO('La fecha de ingreso'),
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

export type DatosFormularioHermano = z.infer<typeof esquemaHermano>;

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
