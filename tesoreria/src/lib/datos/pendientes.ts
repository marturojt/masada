/*
 * El panel de pendientes de evidencia: todo lo capturado sin su documento, en
 * un solo lugar. Cada consulta excluye lo ya dispensado ("sin evidencia
 * formal"), porque ese pendiente ya se atendió: se buscó y no hay.
 */
import { consulta } from '../db';

const SIN_DISPENSA = (entidad: string, columnaId: string) => `
  not exists (select 1 from evidencia_dispensa d
               where d.entidad = '${entidad}' and d.entidad_id = ${columnaId})`;

export interface PendienteEvidencia {
  entidad: 'movimiento' | 'traspaso' | 'aportacion' | 'gt_obligacion' | 'gt_membresia';
  entidad_id: number;
  fecha: string;
  titulo: string;
  detalle: string | null;
  monto_centavos: number | null;
  /** Ruta donde se puede adjuntar la evidencia, si existe ese camino. */
  adjuntar_en: string | null;
  ver_en: string;
}

export async function pendientesDeEvidencia(): Promise<PendienteEvidencia[]> {
  const filas = await consulta<PendienteEvidencia>(
    `
    select 'movimiento' as entidad, m.id as entidad_id, m.fecha::text as fecha,
           c.nombre || coalesce(' · ' || h.nombre_completo, '') as titulo,
           m.descripcion as detalle, m.monto_centavos,
           '/ingresos/' || m.id || '/comprobante' as adjuntar_en,
           '/ingresos' as ver_en
      from movimiento m
      join concepto c on c.id = m.concepto_id
      left join hermano h on h.id = m.hermano_id
     where m.tipo = 'ingreso' and m.archivo_id is null
       and not exists (select 1 from movimiento_ajuste ma where ma.movimiento_ajuste_id = m.id)
       and ${SIN_DISPENSA('movimiento', 'm.id')}

    union all
    select 'traspaso', t.id, t.fecha::text,
           'Traspaso de ' || t.de_bolsa || ' a ' || t.a_bolsa,
           t.descripcion, t.monto_centavos,
           null, '/traspasos'
      from traspaso t
     where t.archivo_id is null
       and ${SIN_DISPENSA('traspaso', 't.id')}

    union all
    select 'aportacion', a.id, a.fecha::text,
           'Aportación en especie de ' || a.aportante_nombre,
           a.descripcion, a.valor_estimado_centavos,
           null, '/aportaciones/' || a.id || '/constancia'
      from aportacion a
     where a.tipo = 'especie' and a.documento_id is null
       and ${SIN_DISPENSA('aportacion', 'a.id')}

    union all
    select 'gt_obligacion', o.id, o.fecha_documento::text,
           'Obligación ' || o.folio || ' sin el documento del cálculo',
           o.observaciones, o.monto_reportado_centavos,
           null, '/gran-tesoreria/obligaciones/' || o.id
      from gt_obligacion o
     where o.documento_calculo_id is null and o.estatus <> 'cancelada'
       and ${SIN_DISPENSA('gt_obligacion', 'o.id')}

    union all
    select 'gt_membresia', gm.id, gm.fecha_documento::text,
           'Membresía de ' || to_char(gm.periodo_referencia, 'TMMonth YYYY') || ' sin documento',
           gm.observaciones, null,
           null, '/gran-tesoreria/membresias/' || gm.id
      from gt_membresia gm
     where gm.archivo_id is null
       and ${SIN_DISPENSA('gt_membresia', 'gm.id')}

    order by fecha desc
    `,
  );
  return filas;
}

/** Las dispensas ya otorgadas, para el registro histórico del panel. */
export interface DispensaFila {
  id: number;
  entidad: string;
  entidad_id: number;
  motivo: string;
  creado_en: string;
  creado_nombre: string;
}

export const dispensasOtorgadas = (): Promise<DispensaFila[]> =>
  consulta<DispensaFila>(
    `select d.id, d.entidad, d.entidad_id, d.motivo, d.creado_en::text,
            u.nombre as creado_nombre
       from evidencia_dispensa d
       join usuario u on u.id = d.creado_por
      order by d.creado_en desc`,
  );
