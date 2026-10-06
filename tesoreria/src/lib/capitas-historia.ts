/*
 * La historia de un plan de cápita en una frase, para el tooltip de la matriz
 * y del estado por hermano: qué modalidad es, de dónde salió el monto, quién
 * la autorizó y, en los casos especiales como una promoción convertida a
 * mensual, qué pasó exactamente.
 */
import type { PlanConHistoria } from './datos/capitas';
import { formatoMXN } from './dinero';
import { formatoFechaCorta, nombreMes } from './fechas';

export type { PlanConHistoria } from './datos/capitas';

export function historiaDelPlan(plan: PlanConHistoria | undefined): string {
  if (!plan) return 'Sin modalidad asignada este ejercicio.';

  const partes: string[] = [];

  if (plan.modalidad === 'promocion') {
    partes.push(
      `Anual preferencial de ${formatoMXN(plan.monto_total_centavos)} en un solo cargo` +
        (plan.autorizado_nombre
          ? `, autorizada por ${plan.autorizado_nombre}` +
            (plan.autorizado_en ? ` el ${formatoFechaCorta(plan.autorizado_en.slice(0, 10))}` : '')
          : '') +
        '; admite abonos hasta saldarla',
    );
  } else if (plan.modalidad === 'prorrateo') {
    partes.push(
      `Prorrateo de ${nombreMes(plan.mes_desde)} a ${nombreMes(plan.mes_hasta)}: ` +
        `${plan.mes_hasta - plan.mes_desde + 1} mes(es) de ${formatoMXN(plan.monto_mensual_centavos)}, ` +
        `total ${formatoMXN(plan.monto_total_centavos)}`,
    );
  } else if (plan.reemplazo_de === 'promocion') {
    partes.push(
      `Promoción convertida a mensual: lo pagado la saldó` +
        (plan.condonado_centavos > 0
          ? ` (${formatoMXN(plan.condonado_centavos)} condonados con autorización)`
          : '') +
        `, y de ${nombreMes(plan.mes_desde)} a ${nombreMes(plan.mes_hasta)} paga ` +
        `${formatoMXN(plan.monto_mensual_centavos)} al mes`,
    );
  } else {
    partes.push(
      `Mensual de ${formatoMXN(plan.monto_mensual_centavos)}, ` +
        `${nombreMes(plan.mes_desde)} a ${nombreMes(plan.mes_hasta)}, ` +
        `total ${formatoMXN(plan.monto_total_centavos)}`,
    );
  }

  if (plan.motivo) partes.push(`Motivo: ${plan.motivo}`);

  return partes.join('. ') + '.';
}
