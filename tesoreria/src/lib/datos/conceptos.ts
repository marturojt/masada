/*
 * Catálogo de conceptos. Administrable por el tesorero: puede agregar los que
 * necesite sin tocar código, mientras no requieran lógica propia.
 */
import { consulta, unaFila, type Tx } from '../db';

export type Naturaleza = 'ingreso' | 'egreso';

export type TipoEspecial =
  | 'capita'
  | 'cuota_grado'
  | 'donativo'
  | 'devolucion_por_comprobar'
  | 'gran_tesoreria'
  | 'gran_logia_grado'
  | 'otro';

export interface Concepto {
  id: number;
  clave: string;
  nombre: string;
  naturaleza: Naturaleza;
  tipo_especial: TipoEspecial;
  requiere_hermano: boolean;
  requiere_comprobante: boolean;
  por_comprobar_por_defecto: boolean;
  seleccionable: boolean;
  activo: boolean;
  orden: number;
  notas: string | null;
}

const COLUMNAS = `id, clave, nombre, naturaleza, tipo_especial, requiere_hermano,
       requiere_comprobante, por_comprobar_por_defecto, seleccionable, activo, orden, notas`;

export interface FiltroConceptos {
  naturaleza?: Naturaleza;
  /** Solo los que se ofrecen en los formularios de captura. */
  soloSeleccionables?: boolean;
  incluirInactivos?: boolean;
}

export function listarConceptos(filtro: FiltroConceptos = {}): Promise<Concepto[]> {
  const condiciones: string[] = [];
  const params: unknown[] = [];

  if (filtro.naturaleza) {
    params.push(filtro.naturaleza);
    condiciones.push(`naturaleza = $${params.length}`);
  }
  if (filtro.soloSeleccionables) condiciones.push('seleccionable = true');
  if (!filtro.incluirInactivos) condiciones.push('activo = true');

  const donde = condiciones.length > 0 ? `where ${condiciones.join(' and ')}` : '';

  return consulta<Concepto>(
    `select ${COLUMNAS} from concepto ${donde} order by naturaleza, orden, nombre`,
    params,
  );
}

export const obtenerConcepto = (id: number): Promise<Concepto | null> =>
  unaFila<Concepto>(`select ${COLUMNAS} from concepto where id = $1`, [id]);

export const conceptoPorClave = (clave: string): Promise<Concepto | null> =>
  unaFila<Concepto>(`select ${COLUMNAS} from concepto where clave = $1`, [clave]);

export interface DatosConcepto {
  nombre: string;
  naturaleza: Naturaleza;
  requiere_hermano: boolean;
  requiere_comprobante: boolean;
  por_comprobar_por_defecto: boolean;
  orden: number;
  notas?: string | undefined;
}

/**
 * Los conceptos que crea el tesorero son siempre de tipo_especial 'otro': los
 * que llevan lógica propia se siembran en una migración y no se inventan desde
 * la interfaz.
 */
export async function insertarConcepto(
  tx: Tx,
  clave: string,
  datos: DatosConcepto,
  usuarioId: number,
): Promise<number> {
  const fila = await tx.laFila<{ id: number }>(
    `insert into concepto
       (clave, nombre, naturaleza, tipo_especial, requiere_hermano, requiere_comprobante,
        por_comprobar_por_defecto, seleccionable, orden, notas, creado_por, actualizado_por)
     values ($1, $2, $3, 'otro', $4, $5, $6, true, $7, $8, $9, $9)
     returning id`,
    [
      clave,
      datos.nombre,
      datos.naturaleza,
      datos.requiere_hermano,
      datos.requiere_comprobante,
      datos.por_comprobar_por_defecto,
      datos.orden,
      datos.notas ?? null,
      usuarioId,
    ],
  );
  return fila.id;
}

export async function actualizarConcepto(
  tx: Tx,
  id: number,
  datos: DatosConcepto,
): Promise<void> {
  await tx.consulta(
    `update concepto set
       nombre = $2, requiere_hermano = $3, requiere_comprobante = $4,
       por_comprobar_por_defecto = $5, orden = $6, notas = $7
     where id = $1`,
    [
      id,
      datos.nombre,
      datos.requiere_hermano,
      datos.requiere_comprobante,
      datos.por_comprobar_por_defecto,
      datos.orden,
      datos.notas ?? null,
    ],
  );
}

/**
 * Los conceptos no se borran: desactivarlos los saca de los formularios y deja
 * intactos los movimientos históricos que los usaron.
 */
export async function cambiarActivo(tx: Tx, id: number, activo: boolean): Promise<void> {
  await tx.consulta('update concepto set activo = $2 where id = $1', [id, activo]);
}

/** Cuántos movimientos usan cada concepto, para la pantalla del catálogo. */
export const usoDeConceptos = (): Promise<{ concepto_id: number; usos: number }[]> =>
  consulta(
    `select concepto_id, count(*)::int as usos from movimiento group by concepto_id`,
  );
