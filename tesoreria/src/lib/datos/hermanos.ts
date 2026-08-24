/*
 * Consultas del padrón. Todo parametrizado, nunca select *, y una función por
 * consulta: cuando la interfaz y el SQL cambian, cambian juntos.
 */
import { consulta, unaFila, type Tx } from '../db';
import type { Grado } from '../tipos';

export interface HermanoFila {
  id: number;
  nombre_completo: string;
  grado: Grado;
  fecha_ingreso: string;
  motivo_ingreso: string;
  fecha_iniciacion: string | null;
  fecha_afiliacion: string | null;
  estatus: 'activo' | 'baja';
  fecha_baja: string | null;
  motivo_baja: string | null;
  correo: string | null;
  telefono: string | null;
  notas: string | null;
}

export interface HermanoListado extends HermanoFila {
  cargo_nombre: string | null;
  cargo_clave: string | null;
}

const COLUMNAS = `h.id, h.nombre_completo, h.grado, h.fecha_ingreso, h.motivo_ingreso,
       h.fecha_iniciacion, h.fecha_afiliacion, h.estatus, h.fecha_baja, h.motivo_baja,
       h.correo, h.telefono, h.notas`;

export interface FiltroPadron {
  estatus?: 'activo' | 'baja' | 'todos';
  grado?: Grado;
  anio: number;
}

/** Padrón con el cargo que cada hermano ocupa en el año indicado. */
export async function listarHermanos(filtro: FiltroPadron): Promise<HermanoListado[]> {
  const condiciones: string[] = [];
  const params: unknown[] = [filtro.anio];

  if (filtro.estatus && filtro.estatus !== 'todos') {
    params.push(filtro.estatus);
    condiciones.push(`h.estatus = $${params.length}`);
  }
  if (filtro.grado) {
    params.push(filtro.grado);
    condiciones.push(`h.grado = $${params.length}::grado_masonico`);
  }

  const donde = condiciones.length > 0 ? `where ${condiciones.join(' and ')}` : '';

  return consulta<HermanoListado>(
    `select ${COLUMNAS}, c.nombre as cargo_nombre, c.clave as cargo_clave
       from hermano h
       left join cuadro_asignacion ca on ca.hermano_id = h.id and ca.anio = $1
       left join cargo c on c.id = ca.cargo_id
       ${donde}
      order by h.grado desc, h.nombre_completo`,
    params,
  );
}

export const obtenerHermano = (id: number): Promise<HermanoListado | null> =>
  unaFila<HermanoListado>(
    `select ${COLUMNAS}, c.nombre as cargo_nombre, c.clave as cargo_clave
       from hermano h
       left join cuadro_asignacion ca on ca.hermano_id = h.id
         and ca.anio = (select max(anio) from ejercicio)
       left join cargo c on c.id = ca.cargo_id
      where h.id = $1`,
    [id],
  );

/** Hermanos activos, para los selectores de los formularios. */
export const hermanosActivos = (): Promise<
  Pick<HermanoFila, 'id' | 'nombre_completo' | 'grado'>[]
> =>
  consulta(
    `select id, nombre_completo, grado
       from hermano
      where estatus = 'activo'
      order by grado desc, nombre_completo`,
  );

export interface DatosHermano {
  nombre_completo: string;
  grado: Grado;
  fecha_ingreso: string;
  motivo_ingreso: string;
  fecha_iniciacion?: string | undefined;
  fecha_afiliacion?: string | undefined;
  correo?: string | undefined;
  telefono?: string | undefined;
  notas?: string | undefined;
}

export async function insertarHermano(
  tx: Tx,
  datos: DatosHermano,
  usuarioId: number,
): Promise<number> {
  const fila = await tx.laFila<{ id: number }>(
    `insert into hermano
       (nombre_completo, grado, fecha_ingreso, motivo_ingreso, fecha_iniciacion,
        fecha_afiliacion, correo, telefono, notas, creado_por, actualizado_por)
     values ($1, $2::grado_masonico, $3, $4, $5, $6, $7, $8, $9, $10, $10)
     returning id`,
    [
      datos.nombre_completo,
      datos.grado,
      datos.fecha_ingreso,
      datos.motivo_ingreso,
      datos.fecha_iniciacion ?? null,
      datos.fecha_afiliacion ?? null,
      datos.correo ?? null,
      datos.telefono ?? null,
      datos.notas ?? null,
      usuarioId,
    ],
  );
  return fila.id;
}

export async function actualizarHermano(
  tx: Tx,
  id: number,
  datos: DatosHermano,
): Promise<void> {
  await tx.consulta(
    `update hermano set
       nombre_completo = $2, grado = $3::grado_masonico, fecha_ingreso = $4,
       motivo_ingreso = $5, fecha_iniciacion = $6, fecha_afiliacion = $7,
       correo = $8, telefono = $9, notas = $10
     where id = $1`,
    [
      id,
      datos.nombre_completo,
      datos.grado,
      datos.fecha_ingreso,
      datos.motivo_ingreso,
      datos.fecha_iniciacion ?? null,
      datos.fecha_afiliacion ?? null,
      datos.correo ?? null,
      datos.telefono ?? null,
      datos.notas ?? null,
    ],
  );
}

/** Da de baja o reactiva. La baja conserva los adeudos anteriores. */
export async function cambiarEstatus(
  tx: Tx,
  id: number,
  baja: { fecha: string; motivo: string } | null,
): Promise<void> {
  if (baja) {
    await tx.consulta(
      `update hermano set estatus = 'baja', fecha_baja = $2, motivo_baja = $3 where id = $1`,
      [id, baja.fecha, baja.motivo],
    );
  } else {
    await tx.consulta(
      `update hermano set estatus = 'activo', fecha_baja = null, motivo_baja = null
        where id = $1`,
      [id],
    );
  }
}

export interface EventoGrado {
  id: number;
  grado: Grado;
  fecha: string;
  tipo_evento: string;
  notas: string | null;
}

export const historialGrados = (hermanoId: number): Promise<EventoGrado[]> =>
  consulta<EventoGrado>(
    `select id, grado, fecha, tipo_evento, notas
       from hermano_grado
      where hermano_id = $1
      order by fecha, id`,
    [hermanoId],
  );

export async function registrarEventoGrado(
  tx: Tx,
  hermanoId: number,
  evento: { grado: Grado; fecha: string; tipoEvento: string; notas?: string | undefined },
  usuarioId: number,
): Promise<void> {
  await tx.consulta(
    `insert into hermano_grado (hermano_id, grado, fecha, tipo_evento, notas, creado_por)
     values ($1, $2::grado_masonico, $3, $4, $5, $6)
     on conflict (hermano_id, tipo_evento, fecha) do nothing`,
    [hermanoId, evento.grado, evento.fecha, evento.tipoEvento, evento.notas ?? null, usuarioId],
  );
}

/** Conteo por grado y estatus, para el encabezado del padrón. */
export const resumenPadron = (): Promise<
  { grado: Grado; activos: number; bajas: number }[]
> =>
  consulta(
    `select grado,
            count(*) filter (where estatus = 'activo')::int as activos,
            count(*) filter (where estatus = 'baja')::int as bajas
       from hermano
      group by grado
      order by grado desc`,
  );
