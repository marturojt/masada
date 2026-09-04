import { z } from 'zod';
import {
  bolsa,
  fechaISO,
  idOpcional,
  idPositivo,
  montoEnCentavos,
  notas,
  opcionDe,
  periodoISO,
  texto,
  textoOpcional,
} from './comunes';

/** Alta de un egreso. Todavía no mueve dinero: falta autorizarlo y entregarlo. */
export const esquemaEgreso = z.object({
  fecha_solicitud: fechaISO('La fecha'),
  concepto_id: idPositivo('El concepto'),
  beneficiario: texto('El beneficiario', 150),
  descripcion: texto('La descripción', 400),
  hermano_id: idOpcional('El hermano'),
  monto: montoEnCentavos('El monto'),
  requiere_comprobacion: z.preprocess((v) => v === 'on' || v === 'true', z.boolean()),
  notas: notas(1000),

  /* Solo para el pago de cápitas a la Gran Tesorería. */
  tipo_pago: opcionDe(
    ['ordinario', 'retroactivo', 'extraordinario'],
    'Elige el tipo de pago.',
  ).optional(),
  periodo_desde: periodoISO('El periodo desde').optional(),
  periodo_hasta: periodoISO('El periodo hasta').optional(),
  capitas: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : null),
      z.number().int('Las cápitas deben ser un número entero.').min(0).max(500).nullable(),
    )
    .optional(),
});

export type DatosEgresoFormulario = z.infer<typeof esquemaEgreso>;

/*
 * El pago a la Gran Tesorería tiene su propia pantalla: el concepto lo pone el
 * sistema y nunca se entrega por comprobar, así que esos dos campos no viajan en
 * el formulario.
 */
export const esquemaGranTesoreria = esquemaEgreso.omit({
  concepto_id: true,
  requiere_comprobacion: true,
  hermano_id: true,
});

export type DatosGranTesoreriaFormulario = z.infer<typeof esquemaGranTesoreria>;

/** Firma de un egreso. El V∴M∴ puede firmar por el tesorero con motivo. */
export const esquemaFirma = z.object({
  rol_requerido: opcionDe(['tesorero', 'venerable_maestro'], 'Rol no válido.'),
  motivo_suplencia: textoOpcional('El motivo de la suplencia', 300),
});

/** Entrega del dinero. Es la transición que saca el dinero de la caja. */
export const esquemaEntrega = z.object({
  fecha_entrega: fechaISO('La fecha de entrega'),
  monto_entregado: montoEnCentavos('El monto entregado'),
  bolsa,
  descripcion_pago: textoOpcional('La descripción', 300),
});

/** Recibo o factura que comprueba parte de un gasto entregado por comprobar. */
export const esquemaComprobacion = z.object({
  tipo: opcionDe(['recibo', 'factura'], 'Elige recibo o factura.'),
  fecha: fechaISO('La fecha del recibo'),
  monto: montoEnCentavos('El monto del recibo'),
  descripcion: textoOpcional('La descripción', 300),
});

/** Devolución del sobrante de un gasto por comprobar. */
export const esquemaDevolucion = z.object({
  fecha: fechaISO('La fecha de la devolución'),
  monto: montoEnCentavos('El monto devuelto'),
  bolsa,
});

/** Documento suelto: el cálculo de la Gran Tesorería, el comprobante de pago, otro. */
export const esquemaDocumento = z.object({
  tipo: opcionDe(
    ['calculo_gran_tesoreria', 'comprobante_pago', 'recibo_gt', 'otro'],
    'Elige el tipo de documento.',
  ),
  fecha: fechaISO('La fecha'),
  descripcion: textoOpcional('La descripción', 300),
});

/** Rechazo o cancelación, siempre con motivo. */
export const esquemaMotivo = z.object({
  motivo: texto('El motivo', 300),
});

/** Cierre de la comprobación. */
export const esquemaCierreComprobacion = z.object({
  fecha: fechaISO('La fecha'),
});
