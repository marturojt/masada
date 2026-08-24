/*
 * Límite de intentos de acceso, persistido en base porque systemd reinicia el
 * proceso y la memoria se va justo cuando más importa que el contador siga ahí.
 */
import { consulta, unaFila } from './db';

/** Fallos tolerados para un mismo correo antes de bloquear. */
const MAX_FALLOS_CORREO = 5;
/*
 * Fallos tolerados para una misma IP. Es un techo más alto y a propósito: si se
 * bloqueara la IP con los mismos 5 fallos, cualquiera podría dejar fuera al
 * tesorero fallando cinco veces con otro correo, y detrás del proxy del VPS
 * ambos usuarios comparten IP.
 */
const MAX_FALLOS_IP = 25;
const VENTANA_MINUTOS = 15;

export interface EstadoLimite {
  bloqueado: boolean;
  /** Segundos que faltan para poder volver a intentar. */
  esperaSegundos: number;
}

export async function revisarLimite(
  correo: string,
  ip: string | null,
): Promise<EstadoLimite> {
  /*
   * Los parámetros van con cast explícito: sin él, Postgres no puede inferir el
   * tipo de un parámetro que solo aparece en un "is not null".
   */
  const fila = await unaFila<{
    fallos_correo: number;
    fallos_ip: number;
    mas_antiguo: string | null;
  }>(
    `select count(*) filter (where correo = $1::text)::int as fallos_correo,
            count(*) filter (where $2::text is not null and ip = $2::text)::int as fallos_ip,
            min(momento)::text as mas_antiguo
       from intento_acceso
      where exito = false
        and momento > now() - make_interval(mins => $3::int)
        and (correo = $1::text or ($2::text is not null and ip = $2::text))`,
    [correo.toLowerCase(), ip, VENTANA_MINUTOS],
  );

  const excedido =
    (fila?.fallos_correo ?? 0) >= MAX_FALLOS_CORREO ||
    (fila?.fallos_ip ?? 0) >= MAX_FALLOS_IP;

  if (!excedido) return { bloqueado: false, esperaSegundos: 0 };

  const desde = fila?.mas_antiguo ? new Date(fila.mas_antiguo).getTime() : Date.now();
  const libreEn = desde + VENTANA_MINUTOS * 60 * 1000;
  const espera = Math.max(1, Math.ceil((libreEn - Date.now()) / 1000));
  return { bloqueado: true, esperaSegundos: espera };
}

export async function registrarIntento(
  correo: string,
  ip: string | null,
  exito: boolean,
): Promise<void> {
  await consulta(
    'insert into intento_acceso (correo, ip, exito) values ($1, $2, $3)',
    [correo.toLowerCase(), ip, exito],
  );
  if (exito) {
    /* Un acceso correcto limpia el historial de fallos de ese correo. */
    await consulta(
      'delete from intento_acceso where correo = $1 and exito = false',
      [correo.toLowerCase()],
    );
  }
}

/** Retardo constante en toda respuesta de login, para no filtrar por tiempos. */
export const esperaConstante = (ms = 250): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms));
