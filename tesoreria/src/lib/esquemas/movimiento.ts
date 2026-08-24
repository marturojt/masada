import { z } from 'zod';
import {
  bolsa,
  fechaISO,
  idOpcional,
  idPositivo,
  montoEnCentavos,
  notas,
  opcionDe,
  texto,
  textoOpcional,
} from './comunes';

/** Ingreso que no es cápita: cuotas de grado del candidato, donativos y otros. */
export const esquemaIngreso = z.object({
  fecha: fechaISO('La fecha'),
  concepto_id: idPositivo('El concepto'),
  monto: montoEnCentavos('El monto'),
  bolsa,
  hermano_id: idOpcional('El hermano'),
  /* Si se deja vacía, el caso de uso la arma con el concepto y el hermano. */
  descripcion: textoOpcional('La descripción', 300),
});

export type DatosIngreso = z.infer<typeof esquemaIngreso>;

/** Concepto nuevo o editado del catálogo. */
export const esquemaConcepto = z.object({
  nombre: texto('El nombre', 120),
  naturaleza: opcionDe(['ingreso', 'egreso'], 'Elige si es ingreso o egreso.'),
  requiere_hermano: z.preprocess((v) => v === 'on' || v === 'true', z.boolean()),
  requiere_comprobante: z.preprocess((v) => v === 'on' || v === 'true', z.boolean()),
  por_comprobar_por_defecto: z.preprocess((v) => v === 'on' || v === 'true', z.boolean()),
  orden: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : 100),
    z.number().int('El orden debe ser un número entero.').min(1).max(999),
  ),
  notas: notas(500),
});

export type DatosConceptoFormulario = z.infer<typeof esquemaConcepto>;

/** Activar o desactivar un concepto del catálogo. */
export const esquemaActivarConcepto = z.object({
  concepto_id: idPositivo('El concepto'),
  activo: opcionDe(['si', 'no'], 'Valor no válido.'),
});
