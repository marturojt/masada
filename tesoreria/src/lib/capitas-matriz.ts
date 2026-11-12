/*
 * Lo que comparten la matriz de cápitas de /capitas y la de los reportes: el
 * símbolo de cada estado, su nombre en texto y la rejilla hermano por mes. Así
 * la pantalla, la hoja impresa y el CSV dicen siempre lo mismo.
 */
import type { AdeudoMes } from './datos/capitas';

/* Se distinguen por forma, no por color: se leen igual en blanco y negro. */
export const SIMBOLO_MES: Record<string, string> = {
  cubierto: '●',
  parcial: '◐',
  vencido_parcial: '◐',
  vencido: '✕',
  pendiente: '·',
};

/** Nombre del estado en texto, para el CSV y los lectores de pantalla. */
export const TEXTO_MES: Record<string, string> = {
  cubierto: 'cubierto',
  parcial: 'parcial',
  vencido_parcial: 'vencido, pago parcial',
  vencido: 'vencido',
  pendiente: 'pendiente',
};

export const SIN_CARGO = 'sin cargo';

export const LEYENDA_MATRIZ =
  '● cubierto · ◐ parcial · ✕ vencido · · pendiente · – sin cargo ese mes';

/** hermano -> mes (1 a 12) -> cargo de ese mes. */
export function matrizPorHermano(adeudos: AdeudoMes[]): Map<number, Map<number, AdeudoMes>> {
  const porHermano = new Map<number, Map<number, AdeudoMes>>();
  for (const a of adeudos) {
    const mes = Number(a.periodo.slice(5, 7));
    const fila = porHermano.get(a.hermano_id) ?? new Map<number, AdeudoMes>();
    fila.set(mes, a);
    porHermano.set(a.hermano_id, fila);
  }
  return porHermano;
}
