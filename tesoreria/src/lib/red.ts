import { config } from './config';

/**
 * IP del cliente. Solo se cree a X-Forwarded-For si TS_CONFIAR_PROXY es true,
 * y entonces se toma el último salto, que es el que agregó el proxy propio.
 * Confiar en esa cabecera sin proxy delante es dejar que cualquiera se invente
 * su IP y burle el límite de intentos.
 */
export function ipDelCliente(peticion: Request, directa: string | undefined): string | null {
  if (config.TS_CONFIAR_PROXY) {
    const cabecera = peticion.headers.get('x-forwarded-for');
    if (cabecera) {
      const saltos = cabecera.split(',').map((s) => s.trim()).filter(Boolean);
      const ultimo = saltos.at(-1);
      if (ultimo) return ultimo.slice(0, 100);
    }
  }
  return directa ? directa.slice(0, 100) : null;
}
