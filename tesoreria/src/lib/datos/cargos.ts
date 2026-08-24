/*
 * Cargos del cuadro y su asignación por año.
 */
import { consulta, unaFila, type Tx } from '../db';

export interface Cargo {
  id: number;
  clave: string;
  nombre: string;
  clave_json: string | null;
  es_dignatario: boolean;
  orden: number;
}

export const listarCargos = (): Promise<Cargo[]> =>
  consulta<Cargo>(
    `select id, clave, nombre, clave_json, es_dignatario, orden
       from cargo
      where activo = true
      order by orden, nombre`,
  );

export interface AsignacionCuadro extends Cargo {
  hermano_id: number;
  nombre_completo: string;
}

/** Cuadro de un año: dignatarios y oficiales con su titular. */
export const cuadroDelAnio = (anio: number): Promise<AsignacionCuadro[]> =>
  consulta<AsignacionCuadro>(
    `select c.id, c.clave, c.nombre, c.clave_json, c.es_dignatario, c.orden,
            h.id as hermano_id, h.nombre_completo
       from cuadro_asignacion ca
       join cargo c on c.id = ca.cargo_id
       join hermano h on h.id = ca.hermano_id
      where ca.anio = $1
      order by c.es_dignatario desc, ca.orden, c.orden`,
    [anio],
  );

export const cargoDeHermano = (
  anio: number,
  hermanoId: number,
): Promise<{ cargo_id: number } | null> =>
  unaFila<{ cargo_id: number }>(
    'select cargo_id from cuadro_asignacion where anio = $1 and hermano_id = $2',
    [anio, hermanoId],
  );

/**
 * Asigna un cargo a un hermano para un año, o se lo quita si cargoId es null.
 * Si el cargo ya lo tenía otro hermano, se lo traspasa: solo hay un titular por
 * cargo y año.
 */
export async function asignarCargo(
  tx: Tx,
  anio: number,
  hermanoId: number,
  cargoId: number | null,
  usuarioId: number,
): Promise<void> {
  await tx.consulta('delete from cuadro_asignacion where anio = $1 and hermano_id = $2', [
    anio,
    hermanoId,
  ]);

  if (cargoId === null) return;

  await tx.consulta('delete from cuadro_asignacion where anio = $1 and cargo_id = $2', [
    anio,
    cargoId,
  ]);
  await tx.consulta(
    `insert into cuadro_asignacion (anio, cargo_id, hermano_id, orden, creado_por)
     values ($1, $2, $3, (select orden from cargo where id = $2), $4)`,
    [anio, cargoId, hermanoId, usuarioId],
  );
}

export interface PastMaster {
  anio: number;
  nombre: string;
  hermano_id: number | null;
  derivado: boolean;
}

/**
 * Past masters: los Venerables Maestros de ejercicios anteriores derivados del
 * cuadro, más el histórico capturado a mano de los años sin registro. El VM
 * vigente nunca aparece, un past master es siempre de un año concluido.
 */
export const listarPastMasters = (anioVigente: number): Promise<PastMaster[]> =>
  consulta<PastMaster>(
    `with derivados as (
       select ca.anio, h.nombre_completo as nombre, h.id as hermano_id
         from cuadro_asignacion ca
         join cargo c on c.id = ca.cargo_id and c.clave = 'venerable_maestro'
         join hermano h on h.id = ca.hermano_id
        where ca.anio < $1
     )
     select anio, nombre, hermano_id, true as derivado from derivados
     union all
     select p.anio, coalesce(h.nombre_completo, p.nombre), p.hermano_id, false as derivado
       from past_master_historico p
       left join hermano h on h.id = p.hermano_id
      where p.anio not in (select anio from derivados)
        and p.anio < $1
     order by anio desc`,
    [anioVigente],
  );
