/*
 * ABC de usuarios de la plataforma. Solo alguien de nivel V∴M∴ (Venerable
 * Maestro o super administrador) administra usuarios, y con dos candados que
 * la interfaz explica antes de que truenen:
 *
 * 1. Nadie se desactiva ni se baja de nivel a sí mismo.
 * 2. Siempre queda al menos un usuario activo de nivel V∴M∴: sin él, nadie
 *    podría autorizar egresos ni administrar la plataforma.
 *
 * Los usuarios no se borran nunca: se desactivan, para que la bitácora y las
 * firmas históricas sigan apuntando a alguien con nombre.
 */
import { hashearContrasena, revisarFortaleza } from '../auth';
import { registrarEn } from '../bitacora';
import { consumirNonce } from '../csrf';
import { enTransaccion } from '../db';
import {
  actualizarUsuario,
  cambiarActivoUsuario,
  guardarContrasena,
  insertarUsuario,
  obtenerUsuario,
  otrosNivelVMActivos,
} from '../datos/usuarios';
import { ErrorDeNegocio } from '../errores';
import { revocarSesionesDe } from '../sesion';
import type { Sesion } from '../sesion';
import { NOMBRE_ROL, esNivelVM, type Rol } from '../tipos';

interface Contexto {
  sesion: Sesion;
  nonce: string;
  idPeticion: string;
}

function exigirContrasenaFuerte(contrasena: string): void {
  const motivo = revisarFortaleza(contrasena);
  if (motivo) throw new ErrorDeNegocio(motivo, 'contrasena');
}

export async function crearUsuario(
  ctx: Contexto,
  datos: { correo: string; nombre: string; rol: Rol; contrasena: string },
): Promise<number> {
  exigirContrasenaFuerte(datos.contrasena);
  const hash = await hashearContrasena(datos.contrasena);

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'usuario_nuevo');
    let id: number;
    try {
      id = await insertarUsuario(tx, { ...datos, hashContrasena: hash });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ErrorDeNegocio('Ya hay un usuario con ese correo.', 'correo');
      }
      throw error;
    }
    await registrarEn(tx, {
      usuarioId: ctx.sesion.usuario.id,
      idPeticion: ctx.idPeticion,
      accion: 'usuario_creado',
      entidad: 'usuario',
      entidadId: id,
      detalle: { correo: datos.correo, nombre: datos.nombre, rol: NOMBRE_ROL[datos.rol] },
    });
    return id;
  }, ctx.sesion.usuario.id);
}

export async function editarUsuario(
  ctx: Contexto,
  id: number,
  datos: { nombre: string; rol: Rol },
): Promise<void> {
  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'usuario_editar');

    const usuario = await obtenerUsuario(id);
    if (!usuario) throw new ErrorDeNegocio('Ese usuario no existe.');

    const pierdeNivel = esNivelVM(usuario.rol) && !esNivelVM(datos.rol);
    if (pierdeNivel && id === ctx.sesion.usuario.id) {
      throw new ErrorDeNegocio(
        'No puedes bajarte de nivel a ti mismo: que lo haga el otro usuario de nivel V∴M∴.',
        'rol',
      );
    }
    if (pierdeNivel && usuario.activo && (await otrosNivelVMActivos(tx, id)) === 0) {
      throw new ErrorDeNegocio(
        'Es el único usuario activo de nivel V∴M∴: primero dale ese nivel a alguien más.',
        'rol',
      );
    }

    await actualizarUsuario(tx, id, datos);
    await registrarEn(tx, {
      usuarioId: ctx.sesion.usuario.id,
      idPeticion: ctx.idPeticion,
      accion: 'usuario_editado',
      entidad: 'usuario',
      entidadId: id,
      detalle: {
        correo: usuario.correo,
        nombre: datos.nombre,
        rol: NOMBRE_ROL[datos.rol],
        rol_anterior: NOMBRE_ROL[usuario.rol],
      },
    });
  }, ctx.sesion.usuario.id);
}

export async function cambiarActivo(
  ctx: Contexto,
  id: number,
  activo: boolean,
): Promise<void> {
  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'usuario_activo');

    const usuario = await obtenerUsuario(id);
    if (!usuario) throw new ErrorDeNegocio('Ese usuario no existe.');
    if (usuario.activo === activo) return;

    if (!activo) {
      if (id === ctx.sesion.usuario.id) {
        throw new ErrorDeNegocio('No puedes desactivar tu propio usuario.');
      }
      if (esNivelVM(usuario.rol) && (await otrosNivelVMActivos(tx, id)) === 0) {
        throw new ErrorDeNegocio(
          'Es el único usuario activo de nivel V∴M∴: primero dale ese nivel a alguien más.',
        );
      }
    }

    await cambiarActivoUsuario(tx, id, activo);
    await registrarEn(tx, {
      usuarioId: ctx.sesion.usuario.id,
      idPeticion: ctx.idPeticion,
      accion: activo ? 'usuario_reactivado' : 'usuario_desactivado',
      entidad: 'usuario',
      entidadId: id,
      detalle: { correo: usuario.correo, nombre: usuario.nombre },
    });
  }, ctx.sesion.usuario.id);

  /* Fuera de la transacción: un desactivado no conserva sesiones abiertas. */
  if (!activo) await revocarSesionesDe(id);
}

export async function restablecerContrasena(
  ctx: Contexto,
  id: number,
  contrasena: string,
): Promise<void> {
  exigirContrasenaFuerte(contrasena);
  const hash = await hashearContrasena(contrasena);

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'usuario_contrasena');
    const usuario = await obtenerUsuario(id);
    if (!usuario) throw new ErrorDeNegocio('Ese usuario no existe.');
    await guardarContrasena(tx, id, hash);
    await registrarEn(tx, {
      usuarioId: ctx.sesion.usuario.id,
      idPeticion: ctx.idPeticion,
      accion: 'usuario_contrasena_restablecida',
      entidad: 'usuario',
      entidadId: id,
      detalle: { correo: usuario.correo },
    });
  }, ctx.sesion.usuario.id);

  /* La contraseña nueva invalida las sesiones que hubiera. */
  await revocarSesionesDe(id);
}
