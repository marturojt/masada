import { z } from 'zod';
import {
  fechaISO,
  fechaISOOpcional,
  idOpcional,
  idPositivo,
  montoEnCentavos,
  montoEnCentavosOpcional,
  notas,
  opcionDe,
  periodoISO,
  texto,
  textoOpcional,
} from './comunes';

export const esquemaTarifaGT = z.object({
  concepto: opcionDe(['capita', 'templo', 'locker', 'otro'], 'Elige el concepto.'),
  descripcion: textoOpcional('La descripción', 120),
  monto: montoEnCentavos('El monto'),
  vigente_desde: fechaISO('La fecha de vigencia'),
});

export const esquemaMembresia = z.object({
  fecha_documento: fechaISO('La fecha del documento'),
  fecha_recepcion: fechaISOOpcional('La fecha de recepción'),
  periodo_referencia: periodoISO('El periodo de referencia'),
  observaciones: notas(500),
});

export const esquemaRenglonMembresia = z.object({
  nombre_reportado: texto('El nombre reportado', 150),
  clave_mason: textoOpcional('La clave masónica', 40),
  grado_reportado: textoOpcional('El grado reportado', 40),
  estatus_reportado: textoOpcional('El estatus reportado', 40),
  genera_capita: z.preprocess((v) => v === 'on' || v === 'true', z.boolean()),
  hermano_id: idOpcional('El hermano'),
});

export const esquemaLigarRenglon = z.object({
  renglon_id: idPositivo('El renglón'),
  hermano_id: idOpcional('El hermano'),
});

export const esquemaObligacion = z.object({
  tipo: opcionDe(
    ['ordinaria', 'regularizacion', 'tramite', 'extraordinaria'],
    'Elige el tipo de obligación.',
  ),
  periodo_desde: periodoISO('El periodo inicial'),
  periodo_hasta: periodoISO('El periodo final'),
  fecha_documento: fechaISO('La fecha del documento'),
  monto_reportado: montoEnCentavos('El monto reportado por la Gran Tesorería'),
  monto_esperado: montoEnCentavosOpcional('El monto esperado'),
  membresia_id: idOpcional('La membresía'),
  hermano_id: idOpcional('El hermano'),
  observaciones: notas(800),
});

/** Trámite ante la Gran Tesorería: una fecha de solicitud, un hermano, una clase. */
export const esquemaTramite = z.object({
  hermano_id: idPositivo('El hermano'),
  tramite_clase: opcionDe(
    ['iniciacion', 'afiliacion', 'aumento_salario', 'exaltacion', 'otro'],
    'Indica qué trámite es.',
  ),
  tramite_descripcion: textoOpcional('El nombre del trámite', 200),
  fecha_solicitud: fechaISO('La fecha de solicitud'),
  monto_reportado: montoEnCentavos('Lo que cobró la Gran Tesorería'),
  observaciones: notas(800),
});

export const esquemaDetalleObligacion = z.object({
  concepto: opcionDe(['capita', 'templo', 'locker', 'tramite', 'otro'], 'Elige el concepto.'),
  cantidad: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : 1),
    z.number().int('La cantidad debe ser un entero.').min(1).max(999),
  ),
  tarifa: montoEnCentavosOpcional('La tarifa'),
  subtotal: montoEnCentavos('El subtotal'),
  hermano_id: idOpcional('El hermano'),
  periodo: periodoISO('El periodo').optional().or(z.literal('').transform(() => undefined)),
  descripcion: textoOpcional('La descripción', 300),
});

export const esquemaRegistroExterno = z.object({
  estatus: opcionDe(['pendiente', 'activo', 'baja', 'desconocido'], 'Elige el estatus.'),
  fecha_registro: fechaISOOpcional('La fecha de registro'),
  fecha_efectiva: fechaISOOpcional('La fecha efectiva'),
  fecha_baja: fechaISOOpcional('La fecha de baja'),
  observaciones: notas(500),
});

export const esquemaAportacionMonetaria = z.object({
  fecha: fechaISO('La fecha'),
  monto: montoEnCentavos('El monto'),
  bolsa: opcionDe(['banco', 'efectivo'], 'Elige la bolsa.'),
  hermano_id: idOpcional('El hermano'),
  aportante_nombre: texto('El nombre del aportante', 150),
  descripcion: texto('La descripción', 300),
  destino: textoOpcional('El destino', 200),
});

export const esquemaAportacionEspecie = z.object({
  fecha: fechaISO('La fecha'),
  hermano_id: idOpcional('El hermano'),
  aportante_nombre: texto('El nombre del aportante', 150),
  descripcion: texto('La descripción del bien', 300),
  destino: textoOpcional('El destino o evento', 200),
  cantidad: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN),
    z.number().positive('La cantidad debe ser mayor que cero.').max(1_000_000),
  ),
  unidad: textoOpcional('La unidad', 40),
  valor_estimado: montoEnCentavosOpcional('El valor estimado'),
});
