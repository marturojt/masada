/*
 * Traspasos entre las bolsas de la logia: el depósito del efectivo de las
 * tenidas al banco, o un retiro. No son ingresos ni egresos, el total no cambia.
 */
import { consulta, type Tx } from '../db';
import { periodoDe } from '../fechas';
import type { Bolsa } from '../tipos';

export interface TraspasoFila {
  id: number;
  fecha: string;
  periodo: string;
  de_bolsa: Bolsa;
  a_bolsa: Bolsa;
  monto_centavos: number;
  descripcion: string;
  archivo_id: number | null;
  corte_id: number | null;
  creado_nombre: string | null;
}

export const listarTraspasos = (anio: number): Promise<TraspasoFila[]> =>
  consulta<TraspasoFila>(
    `select t.id, t.fecha, t.periodo::text, t.de_bolsa, t.a_bolsa, t.monto_centavos,
            t.descripcion, t.archivo_id, t.corte_id, u.nombre as creado_nombre
       from traspaso t
       left join usuario u on u.id = t.creado_por
      where t.ejercicio_anio = $1
      order by t.fecha desc, t.id desc`,
    [anio],
  );

export const traspasosDelPeriodo = (periodo: string): Promise<TraspasoFila[]> =>
  consulta<TraspasoFila>(
    `select t.id, t.fecha, t.periodo::text, t.de_bolsa, t.a_bolsa, t.monto_centavos,
            t.descripcion, t.archivo_id, t.corte_id, u.nombre as creado_nombre
       from traspaso t
       left join usuario u on u.id = t.creado_por
      where t.periodo = $1
      order by t.fecha, t.id`,
    [`${periodo}-01`],
  );

export async function insertarTraspaso(
  tx: Tx,
  datos: {
    fecha: string;
    deBolsa: Bolsa;
    aBolsa: Bolsa;
    montoCentavos: number;
    descripcion: string;
    archivoId?: number | null;
  },
  usuarioId: number,
): Promise<number> {
  const fila = await tx.laFila<{ id: number }>(
    `insert into traspaso
       (fecha, ejercicio_anio, periodo, de_bolsa, a_bolsa, monto_centavos, descripcion,
        archivo_id, creado_por, actualizado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     returning id`,
    [
      datos.fecha,
      Number(datos.fecha.slice(0, 4)),
      `${periodoDe(datos.fecha)}-01`,
      datos.deBolsa,
      datos.aBolsa,
      datos.montoCentavos,
      datos.descripcion,
      datos.archivoId ?? null,
      usuarioId,
    ],
  );
  return fila.id;
}
