import { z } from 'zod';
import {
  bolsa,
  fechaISO,
  idPositivo,
  mes,
  montoEnCentavos,
  notas,
  opcionDe,
  texto,
  textoOpcional,
} from './comunes';

/** Asignación o cambio de modalidad de cápita de un hermano. */
export const esquemaModalidad = z.object({
  hermano_id: idPositivo('El hermano'),
  modalidad: opcionDe(['mensual', 'promocion', 'prorrateo'], 'Elige una modalidad.'),
  /* Solo aplica a promoción: mes en que el VM la habilita. */
  mes_promocion: mes.optional().or(z.literal('').transform(() => undefined)),
  motivo: textoOpcional('El motivo', 300),
});

export type DatosModalidad = z.infer<typeof esquemaModalidad>;

/**
 * Pago de cápita. Se aplica del mes más antiguo con saldo hacia adelante, y lo
 * que sobra queda como saldo a favor: nunca se pierde ni se inventa un mes.
 */
export const esquemaPagoCapita = z.object({
  hermano_id: idPositivo('El hermano'),
  fecha: fechaISO('La fecha del pago'),
  monto: montoEnCentavos('El monto'),
  bolsa,
  descripcion: textoOpcional('La descripción', 300),
});

export type DatosPagoCapita = z.infer<typeof esquemaPagoCapita>;

/** Exención de un mes, a discreción del Venerable Maestro. */
export const esquemaExencion = z.object({
  capita_cargo_id: idPositivo('El mes'),
  monto: montoEnCentavos('El monto a exentar'),
  motivo: texto('El motivo', 300),
});

export type DatosExencion = z.infer<typeof esquemaExencion>;

export const esquemaNotaCapita = z.object({
  notas: notas(1000),
});
