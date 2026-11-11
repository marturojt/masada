import { z } from 'zod';
import {
  confirmacion,
  fechaISO,
  opcionDe,
  idPositivo,
  montoEnCentavos,
  montoEnCentavosOpcional,
  notas,
  texto,
} from './comunes';

export const esquemaCierre = z.object({
  observaciones: notas(1000),
  confirmo: confirmacion('Marca la casilla para confirmar que el mes queda cerrado.'),
});

export const esquemaReapertura = z.object({
  motivo: texto('El motivo', 400),
});

export const esquemaAjuste = z.object({
  movimiento_id: idPositivo('El movimiento'),
  fecha: fechaISO('La fecha del ajuste'),
  monto: montoEnCentavos('El monto del ajuste'),
  motivo: texto('El motivo', 400),
});

/** Mensaje del tesorero para el informe de tenida. Vacío lo borra. */
export const esquemaMensajeInforme = z.object({
  mensaje: notas(4000),
});

/** Arqueo inicial: lo que de verdad hay en banco y en efectivo al arrancar. */
export const esquemaArqueo = z.object({
  fecha: fechaISO('La fecha del arqueo'),
  banco: montoEnCentavos('Lo que hay en el banco', { permitirCero: true }),
  efectivo: montoEnCentavos('Lo que hay en efectivo', { permitirCero: true }),
});

/** Saldo de apertura del ejercicio por bolsa, que en 2026 se captura a mano. */
export const esquemaApertura = z.object({
  apertura_banco: montoEnCentavos('El saldo en banco', { permitirCero: true }),
  apertura_efectivo: montoEnCentavos('El saldo en efectivo', { permitirCero: true }),
  notas: notas(500),
});

/** Traspaso entre bolsas: el depósito del efectivo al banco, o un retiro. */
export const esquemaTraspaso = z.object({
  fecha: fechaISO('La fecha'),
  direccion: opcionDe(
    ['deposito', 'retiro'],
    'Elige si es depósito al banco o retiro de efectivo.',
  ),
  monto: montoEnCentavos('El monto'),
  descripcion: texto('La descripción', 300),
});

/** Apertura del ejercicio siguiente. Las tarifas vacías heredan las del anterior. */
export const esquemaAbrirEjercicio = z.object({
  capita_mensual: montoEnCentavosOpcional('La cápita mensual'),
  capita_promocion: montoEnCentavosOpcional('La promoción de un pago'),
  capita_promocion_dos: montoEnCentavosOpcional('La promoción de dos pagos'),
});
