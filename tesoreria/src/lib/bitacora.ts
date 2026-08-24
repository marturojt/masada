/*
 * Bitácora en términos del dominio: "autorizó el egreso EG-2026-0004 supliendo al
 * tesorero". La auditoría por trigger (migración 008) guarda el diff de columnas,
 * que es otra pregunta.
 *
 * Nunca se registran cuerpos de formulario, cookies ni tokens.
 */
import { consulta, type Tx } from './db';

export interface Apunte {
  usuarioId?: number | null;
  idPeticion?: string | null;
  accion: string;
  entidad?: string | null;
  entidadId?: string | number | null;
  detalle?: Record<string, unknown> | null;
  ip?: string | null;
}

const SQL = `insert into bitacora
  (usuario_id, id_peticion, accion, entidad, entidad_id, detalle, ip)
  values ($1, $2, $3, $4, $5, $6, $7)`;

function params(a: Apunte): unknown[] {
  return [
    a.usuarioId ?? null,
    a.idPeticion ?? null,
    a.accion,
    a.entidad ?? null,
    a.entidadId == null ? null : String(a.entidadId),
    a.detalle ? JSON.stringify(a.detalle) : null,
    a.ip ?? null,
  ];
}

/** Registra dentro de la transacción del caso de uso. Es la forma preferida. */
export const registrarEn = (tx: Tx, apunte: Apunte): Promise<unknown> =>
  tx.consulta(SQL, params(apunte));

/** Registra fuera de transacción, para eventos que no escriben dinero. */
export const registrar = (apunte: Apunte): Promise<unknown> =>
  consulta(SQL, params(apunte));
