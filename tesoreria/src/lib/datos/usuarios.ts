/*
 * Usuarios de la plataforma. Nunca se borran: se desactivan, para que la
 * bitácora y las firmas históricas sigan apuntando a alguien con nombre.
 */
import { consulta, unaFila, type Tx } from '../db';
import type { Rol } from '../tipos';

export interface UsuarioFila {
  id: number;
  correo: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  creado_en: string;
  ultimo_acceso: string | null;
}

const COLUMNAS = `u.id, u.correo, u.nombre, u.rol, u.activo, u.creado_en::text,
       (select max(s.ultimo_uso)::text from sesion s where s.usuario_id = u.id)
         as ultimo_acceso`;

export const listarUsuarios = (): Promise<UsuarioFila[]> =>
  consulta<UsuarioFila>(
    `select ${COLUMNAS} from usuario u order by u.activo desc, u.nombre`,
  );

export const obtenerUsuario = (id: number): Promise<UsuarioFila | null> =>
  unaFila<UsuarioFila>(`select ${COLUMNAS} from usuario u where u.id = $1`, [id]);

export async function insertarUsuario(
  tx: Tx,
  datos: { correo: string; nombre: string; rol: Rol; hashContrasena: string },
): Promise<number> {
  const fila = await tx.laFila<{ id: number }>(
    `insert into usuario (correo, nombre, hash_contrasena, rol)
     values ($1, $2, $3, $4) returning id`,
    [datos.correo, datos.nombre, datos.hashContrasena, datos.rol],
  );
  return fila.id;
}

export const actualizarUsuario = (
  tx: Tx,
  id: number,
  datos: { nombre: string; rol: Rol },
): Promise<unknown> =>
  tx.consulta('update usuario set nombre = $2, rol = $3 where id = $1', [
    id,
    datos.nombre,
    datos.rol,
  ]);

export const cambiarActivoUsuario = (tx: Tx, id: number, activo: boolean): Promise<unknown> =>
  tx.consulta('update usuario set activo = $2 where id = $1', [id, activo]);

export const guardarContrasena = (tx: Tx, id: number, hash: string): Promise<unknown> =>
  tx.consulta('update usuario set hash_contrasena = $2 where id = $1', [id, hash]);

/** Cuántos usuarios activos de nivel V∴M∴ quedarían sin contar a este. */
export const otrosNivelVMActivos = async (tx: Tx, exceptoId: number): Promise<number> => {
  const fila = await tx.laFila<{ cuantos: number }>(
    `select count(*)::int as cuantos from usuario
      where activo and rol in ('venerable_maestro', 'super_admin') and id <> $1`,
    [exceptoId],
  );
  return fila.cuantos;
};
