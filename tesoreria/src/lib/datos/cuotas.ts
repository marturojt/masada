/*
 * Cuotas de grado por cobrar: lo que una persona debe a la logia por su
 * iniciación, afiliación, aumento de salario o exaltación. La base aplica sola
 * los ingresos de cada cuota (migración 028); aquí solo se consultan y se dan
 * de alta.
 */
import { consulta, unaFila, type Tx } from '../db';

export type EventoCuota = 'iniciacion' | 'afiliacion' | 'aumento_salario' | 'exaltacion';

export const NOMBRE_EVENTO_CUOTA: Record<EventoCuota, string> = {
  iniciacion: 'Iniciación',
  afiliacion: 'Afiliación',
  aumento_salario: 'Aumento de salario',
  exaltacion: 'Exaltación',
};

export interface CuotaGrado {
  id: number;
  hermano_id: number;
  nombre_completo: string;
  hermano_estatus: string;
  tipo_evento: EventoCuota;
  fecha: string;
  monto_centavos: number;
  pagado_centavos: number;
  saldo_centavos: number;
  estatus: 'vigente' | 'cancelado';
  notas: string | null;
  motivo_cancelacion: string | null;
}

const COLUMNAS = `id, hermano_id, nombre_completo, hermano_estatus, tipo_evento, fecha::text,
       monto_centavos, pagado_centavos, saldo_centavos, estatus, notas, motivo_cancelacion`;

export const cuotasDe = (hermanoId: number): Promise<CuotaGrado[]> =>
  consulta<CuotaGrado>(
    `select ${COLUMNAS} from v_cuota_grado_saldo
      where hermano_id = $1
      order by fecha, id`,
    [hermanoId],
  );

/** Todo lo que se debe de cuotas de grado, de lo más antiguo a lo más nuevo. */
export const cuotasPorCobrar = (): Promise<CuotaGrado[]> =>
  consulta<CuotaGrado>(
    `select ${COLUMNAS} from v_cuota_grado_saldo
      where estatus = 'vigente' and saldo_centavos > 0
      order by fecha, id`,
  );

/** La tarifa interna vigente del evento, para proponer el monto de la cuota. */
export const tarifaGradoVigente = async (tipo: EventoCuota): Promise<number | null> =>
  (
    await unaFila<{ monto_centavos: number }>(
      'select monto_centavos from v_tarifa_vigente where tipo_evento = $1',
      [tipo],
    )
  )?.monto_centavos ?? null;

export async function insertarCuota(
  tx: Tx,
  datos: {
    hermanoId: number;
    tipoEvento: EventoCuota;
    montoCentavos: number;
    fecha: string;
    notas?: string | undefined;
  },
  usuarioId: number,
): Promise<number> {
  const fila = await tx.laFila<{ id: number }>(
    `insert into cuota_grado_cargo
       (hermano_id, tipo_evento, monto_centavos, fecha, notas, creado_por)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      datos.hermanoId,
      datos.tipoEvento,
      datos.montoCentavos,
      datos.fecha,
      datos.notas ?? null,
      usuarioId,
    ],
  );
  return fila.id;
}
