/*
 * Tarifas de grado: lo que el candidato paga a la logia por cada evento.
 * Versionadas por fecha de vigencia y nunca retroactivas: cambiar una tarifa es
 * insertar una fila nueva, la historia no se toca (lo impide un trigger).
 */
import { consulta, type Tx } from '../db';

export type TipoEventoTarifa = 'iniciacion' | 'aumento_salario' | 'exaltacion' | 'afiliacion';

export const NOMBRE_TARIFA: Record<TipoEventoTarifa, string> = {
  iniciacion: 'Iniciación',
  aumento_salario: 'Aumento de salario',
  exaltacion: 'Exaltación',
  afiliacion: 'Afiliación',
};

export const TIPOS_TARIFA: TipoEventoTarifa[] = [
  'iniciacion',
  'aumento_salario',
  'exaltacion',
  'afiliacion',
];

export interface TarifaVigente {
  tipo_evento: TipoEventoTarifa;
  monto_centavos: number;
  vigente_desde: string;
}

export const tarifasVigentes = (): Promise<TarifaVigente[]> =>
  consulta<TarifaVigente>('select * from v_tarifa_vigente order by tipo_evento');

export interface TarifaFila {
  id: number;
  tipo_evento: TipoEventoTarifa;
  monto_centavos: number;
  vigente_desde: string;
  notas: string | null;
  creado_nombre: string | null;
  creado_en: string;
}

export const historialTarifas = (): Promise<TarifaFila[]> =>
  consulta<TarifaFila>(
    `select t.id, t.tipo_evento, t.monto_centavos, t.vigente_desde::text, t.notas,
            u.nombre as creado_nombre, t.creado_en::text
       from tarifa_grado t
       left join usuario u on u.id = t.creado_por
      order by t.tipo_evento, t.vigente_desde desc, t.id desc`,
  );

export async function insertarTarifa(
  tx: Tx,
  datos: {
    tipoEvento: TipoEventoTarifa;
    montoCentavos: number;
    vigenteDesde: string;
    notas?: string | undefined;
  },
  usuarioId: number,
): Promise<number> {
  const fila = await tx.laFila<{ id: number }>(
    `insert into tarifa_grado (tipo_evento, monto_centavos, vigente_desde, notas, creado_por)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [datos.tipoEvento, datos.montoCentavos, datos.vigenteDesde, datos.notas ?? null, usuarioId],
  );
  return fila.id;
}
