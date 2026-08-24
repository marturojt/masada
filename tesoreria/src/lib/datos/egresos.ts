/*
 * Consultas de egresos, firmas y documentos.
 */
import { consulta, unaFila, type Tx } from '../db';

export type EstadoEgreso =
  | 'registrado'
  | 'autorizado'
  | 'rechazado'
  | 'cancelado'
  | 'pagado'
  | 'por_comprobar'
  | 'comprobado';

export const NOMBRE_ESTADO_EGRESO: Record<EstadoEgreso, string> = {
  registrado: 'Registrado, falta autorizar',
  autorizado: 'Autorizado, falta entregar',
  rechazado: 'Rechazado',
  cancelado: 'Cancelado',
  pagado: 'Pagado',
  por_comprobar: 'Entregado, por comprobar',
  comprobado: 'Comprobado',
};

export const CLASE_ESTADO_EGRESO: Record<EstadoEgreso, string> = {
  registrado: 'insignia--pendiente',
  autorizado: 'insignia--pendiente',
  rechazado: 'insignia--alerta',
  cancelado: '',
  pagado: 'insignia--ok',
  por_comprobar: 'insignia--alerta',
  comprobado: 'insignia--ok',
};

export interface EgresoFila {
  id: number;
  folio: string;
  fecha_solicitud: string;
  ejercicio_anio: number;
  concepto_id: number;
  concepto_nombre: string;
  tipo_especial: string;
  beneficiario: string;
  descripcion: string;
  hermano_id: number | null;
  hermano_nombre: string | null;
  monto_solicitado_centavos: number;
  monto_autorizado_centavos: number | null;
  monto_entregado_centavos: number | null;
  monto_comprobado_centavos: number;
  monto_devuelto_centavos: number;
  requiere_comprobacion: boolean;
  estado: EstadoEgreso;
  fecha_autorizacion: string | null;
  fecha_entrega: string | null;
  fecha_comprobacion: string | null;
  motivo_rechazo: string | null;
  motivo_cancelacion: string | null;
  notas: string | null;
  firmas: number;
}

const COLUMNAS = `e.id, e.folio, e.fecha_solicitud, e.ejercicio_anio, e.concepto_id,
       c.nombre as concepto_nombre, c.tipo_especial, e.beneficiario, e.descripcion,
       e.hermano_id, h.nombre_completo as hermano_nombre,
       e.monto_solicitado_centavos, e.monto_autorizado_centavos, e.monto_entregado_centavos,
       e.monto_comprobado_centavos, e.monto_devuelto_centavos, e.requiere_comprobacion,
       e.estado, e.fecha_autorizacion::text, e.fecha_entrega, e.fecha_comprobacion,
       e.motivo_rechazo, e.motivo_cancelacion, e.notas,
       (select count(*)::int from egreso_firma f where f.egreso_id = e.id) as firmas`;

const DESDE = `from egreso e
       join concepto c on c.id = e.concepto_id
       left join hermano h on h.id = e.hermano_id`;

export interface FiltroEgresos {
  anio?: number;
  estado?: EstadoEgreso;
  /** Solo los que están esperando firmas o entrega. */
  pendientes?: boolean;
}

export function listarEgresos(filtro: FiltroEgresos = {}): Promise<EgresoFila[]> {
  const condiciones: string[] = [];
  const params: unknown[] = [];

  if (filtro.anio) {
    params.push(filtro.anio);
    condiciones.push(`e.ejercicio_anio = $${params.length}`);
  }
  if (filtro.estado) {
    params.push(filtro.estado);
    condiciones.push(`e.estado = $${params.length}`);
  }
  if (filtro.pendientes) {
    condiciones.push(`e.estado in ('registrado', 'autorizado', 'por_comprobar')`);
  }

  const donde = condiciones.length > 0 ? `where ${condiciones.join(' and ')}` : '';

  return consulta<EgresoFila>(
    `select ${COLUMNAS} ${DESDE} ${donde} order by e.fecha_solicitud desc, e.id desc`,
    params,
  );
}

export const obtenerEgreso = (id: number): Promise<EgresoFila | null> =>
  unaFila<EgresoFila>(`select ${COLUMNAS} ${DESDE} where e.id = $1`, [id]);

export interface DatosEgreso {
  fecha_solicitud: string;
  concepto_id: number;
  beneficiario: string;
  descripcion: string;
  hermano_id: number | null;
  monto_solicitado_centavos: number;
  requiere_comprobacion: boolean;
  notas?: string | undefined;
}

export async function insertarEgreso(
  tx: Tx,
  datos: DatosEgreso,
  usuarioId: number,
): Promise<{ id: number; folio: string }> {
  const anio = Number(datos.fecha_solicitud.slice(0, 4));
  const folio = await tx.laFila<{ folio: string }>(
    'select fn_siguiente_folio($1) as folio',
    [anio],
  );

  const fila = await tx.laFila<{ id: number }>(
    `insert into egreso
       (folio, fecha_solicitud, ejercicio_anio, concepto_id, beneficiario, descripcion,
        hermano_id, monto_solicitado_centavos, requiere_comprobacion, notas,
        creado_por, actualizado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
     returning id`,
    [
      folio.folio,
      datos.fecha_solicitud,
      anio,
      datos.concepto_id,
      datos.beneficiario,
      datos.descripcion,
      datos.hermano_id,
      datos.monto_solicitado_centavos,
      datos.requiere_comprobacion,
      datos.notas ?? null,
      usuarioId,
    ],
  );

  return { id: fila.id, folio: folio.folio };
}

export interface Firma {
  rol_requerido: 'tesorero' | 'venerable_maestro';
  firmado_por: number;
  firmante_nombre: string;
  rol_firmante: 'tesorero' | 'venerable_maestro';
  es_suplencia: boolean;
  motivo_suplencia: string | null;
  firmado_en: string;
}

export const firmasDe = (egresoId: number): Promise<Firma[]> =>
  consulta<Firma>(
    `select f.rol_requerido, f.firmado_por, u.nombre as firmante_nombre, f.rol_firmante,
            f.es_suplencia, f.motivo_suplencia, f.firmado_en::text
       from egreso_firma f
       join usuario u on u.id = f.firmado_por
      where f.egreso_id = $1
      order by f.rol_requerido`,
    [egresoId],
  );

export async function insertarFirma(
  tx: Tx,
  egresoId: number,
  rolRequerido: 'tesorero' | 'venerable_maestro',
  firmadoPor: number,
  rolFirmante: 'tesorero' | 'venerable_maestro',
  motivoSuplencia: string | null,
): Promise<void> {
  const esSuplencia = rolFirmante !== rolRequerido;
  await tx.consulta(
    `insert into egreso_firma
       (egreso_id, rol_requerido, firmado_por, rol_firmante, es_suplencia, motivo_suplencia)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      egresoId,
      rolRequerido,
      firmadoPor,
      rolFirmante,
      esSuplencia,
      esSuplencia ? motivoSuplencia : null,
    ],
  );
}

export const cuentaFirmas = async (tx: Tx, egresoId: number): Promise<number> => {
  const fila = await tx.laFila<{ total: number }>(
    'select count(distinct rol_requerido)::int as total from egreso_firma where egreso_id = $1',
    [egresoId],
  );
  return fila.total;
};

export interface Documento {
  id: number;
  tipo: string;
  fecha: string;
  monto_centavos: number | null;
  descripcion: string | null;
  archivo_id: number | null;
  archivo_nombre: string | null;
  subido_nombre: string | null;
}

export const NOMBRE_DOCUMENTO: Record<string, string> = {
  calculo_gran_tesoreria: 'Cálculo de la Gran Tesorería',
  comprobante_pago: 'Comprobante de pago',
  recibo_gt: 'Recibo de la Gran Tesorería',
  recibo: 'Recibo',
  factura: 'Factura',
  otro: 'Otro documento',
};

export const documentosDe = (egresoId: number): Promise<Documento[]> =>
  consulta<Documento>(
    `select d.id, d.tipo, d.fecha, d.monto_centavos, d.descripcion, d.archivo_id,
            a.nombre_original as archivo_nombre, u.nombre as subido_nombre
       from egreso_documento d
       left join archivo a on a.id = d.archivo_id
       left join usuario u on u.id = d.creado_por
      where d.egreso_id = $1
      order by d.fecha, d.id`,
    [egresoId],
  );

export async function insertarDocumento(
  tx: Tx,
  egresoId: number,
  datos: {
    tipo: string;
    fecha: string;
    montoCentavos?: number | null;
    descripcion?: string | null;
    archivoId?: number | null;
  },
  usuarioId: number,
): Promise<number> {
  const fila = await tx.laFila<{ id: number }>(
    `insert into egreso_documento
       (egreso_id, tipo, fecha, monto_centavos, descripcion, archivo_id, creado_por)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      egresoId,
      datos.tipo,
      datos.fecha,
      datos.montoCentavos ?? null,
      datos.descripcion ?? null,
      datos.archivoId ?? null,
      usuarioId,
    ],
  );
  return fila.id;
}

export const tieneDocumento = async (
  tx: Tx,
  egresoId: number,
  tipo: string,
): Promise<boolean> => {
  const fila = await tx.unaFila<{ id: number }>(
    `select id from egreso_documento
      where egreso_id = $1 and tipo = $2 and archivo_id is not null limit 1`,
    [egresoId, tipo],
  );
  return fila !== null;
};

export interface DatosGranTesoreria {
  tipo_pago: 'ordinario' | 'retroactivo' | 'extraordinario';
  periodo_desde: string;
  periodo_hasta: string;
  capitas: number | null;
  notas?: string | undefined;
}

export const NOMBRE_TIPO_PAGO_GT: Record<string, string> = {
  ordinario: 'Ordinario del mes',
  retroactivo: 'Retroactivo',
  extraordinario: 'Extraordinario',
};

export async function insertarGranTesoreria(
  tx: Tx,
  egresoId: number,
  datos: DatosGranTesoreria,
  usuarioId: number,
): Promise<void> {
  await tx.consulta(
    `insert into egreso_gran_tesoreria
       (egreso_id, tipo_pago, periodo_desde, periodo_hasta, capitas, notas, creado_por)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      egresoId,
      datos.tipo_pago,
      `${datos.periodo_desde}-01`,
      `${datos.periodo_hasta}-01`,
      datos.capitas,
      datos.notas ?? null,
      usuarioId,
    ],
  );
}

export interface GranTesoreriaFila {
  tipo_pago: string;
  periodo_desde: string;
  periodo_hasta: string;
  capitas: number | null;
  notas: string | null;
}

export const granTesoreriaDe = (egresoId: number): Promise<GranTesoreriaFila | null> =>
  unaFila<GranTesoreriaFila>(
    `select tipo_pago, periodo_desde, periodo_hasta, capitas, notas
       from egreso_gran_tesoreria where egreso_id = $1`,
    [egresoId],
  );

export interface PendienteComprobar {
  id: number;
  folio: string;
  fecha_entrega: string;
  beneficiario: string;
  descripcion: string;
  concepto_nombre: string;
  monto_entregado_centavos: number;
  monto_comprobado_centavos: number;
  monto_devuelto_centavos: number;
  pendiente_centavos: number;
  dias_sin_comprobar: number;
}

export const pendientesDeComprobar = (): Promise<PendienteComprobar[]> =>
  consulta<PendienteComprobar>('select * from v_pendiente_comprobar');

/** Totales de egresos del ejercicio, por estado. */
export const resumenEgresos = (
  anio: number,
): Promise<{ estado: EstadoEgreso; cuantos: number; monto_centavos: number }[]> =>
  consulta(
    `select estado, count(*)::int as cuantos,
            sum(coalesce(monto_entregado_centavos, monto_autorizado_centavos,
                         monto_solicitado_centavos))::int as monto_centavos
       from egreso
      where ejercicio_anio = $1
      group by estado
      order by estado`,
    [anio],
  );
