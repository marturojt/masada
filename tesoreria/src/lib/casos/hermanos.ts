/*
 * Casos de uso del padrón. Aquí viven las transacciones y las invariantes; las
 * páginas no hacen SQL y no abren transacciones.
 *
 * Todos consumen el nonce dentro de la misma transacción que escribe, así un
 * doble envío no puede duplicar el registro.
 */
import { registrarEn } from '../bitacora';
import { consumirNonce } from '../csrf';
import { enTransaccion } from '../db';
import {
  actualizarHermano,
  cambiarEstatus,
  insertarHermano,
  registrarEventoGrado,
  type DatosHermano,
} from '../datos/hermanos';
import { asignarCargo } from '../datos/cargos';
import { ErrorDeNegocio } from '../errores';
import type { Sesion } from '../sesion';
import type { Grado } from '../tipos';
import type { DatosHermanoCompletos } from '../esquemas/hermano';

interface Contexto {
  sesion: Sesion;
  nonce: string;
  anio: number;
  idPeticion: string;
}

function comoDatos(f: DatosHermanoCompletos): DatosHermano {
  return {
    nombre_completo: f.nombre_completo,
    grado: f.grado,
    fecha_ingreso: f.fecha_ingreso,
    motivo_ingreso: f.motivo_ingreso,
    fecha_iniciacion: f.fecha_iniciacion,
    fecha_afiliacion: f.fecha_afiliacion,
    correo: f.correo,
    telefono: f.telefono,
    notas: f.notas,
  };
}

/** Traduce el choque de nombre único en un mensaje que sirva a quien captura. */
function traducirError(error: unknown): never {
  const codigo = (error as { code?: string }).code;
  const restriccion = (error as { constraint?: string }).constraint;
  if (codigo === '23505' && restriccion === 'hermano_nombre_unico') {
    throw new ErrorDeNegocio(
      'Ya hay un hermano con ese nombre en el padrón.',
      'nombre_completo',
    );
  }
  throw error;
}

/**
 * El evento de grado inicial se deriva del motivo de ingreso: quien se inició en
 * la logia empieza como aprendiz, quien se afilió llega con el grado que traía.
 */
export function eventoInicial(f: DatosHermanoCompletos): {
  grado: Grado;
  fecha: string;
  tipoEvento: string;
} {
  if (f.motivo_ingreso === 'iniciacion') {
    return { grado: 'aprendiz', fecha: f.fecha_iniciacion ?? f.fecha_ingreso, tipoEvento: 'iniciacion' };
  }
  if (f.motivo_ingreso === 'afiliacion') {
    return { grado: f.grado, fecha: f.fecha_afiliacion ?? f.fecha_ingreso, tipoEvento: 'afiliacion' };
  }
  return { grado: f.grado, fecha: f.fecha_ingreso, tipoEvento: 'regularizacion' };
}

export async function crearHermano(
  ctx: Contexto,
  formulario: DatosHermanoCompletos,
): Promise<number> {
  const usuarioId = ctx.sesion.usuario.id;

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'hermano_nuevo');

    let id: number;
    try {
      id = await insertarHermano(tx, comoDatos(formulario), usuarioId);
    } catch (error) {
      traducirError(error);
    }

    const evento = eventoInicial(formulario);
    await registrarEventoGrado(tx, id, evento, usuarioId);

    if (formulario.cargo_id !== null) {
      await asignarCargo(tx, ctx.anio, id, formulario.cargo_id, usuarioId);
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'hermano_alta',
      entidad: 'hermano',
      entidadId: id,
      detalle: {
        nombre: formulario.nombre_completo,
        grado: formulario.grado,
        ingreso: formulario.fecha_ingreso,
      },
    });

    return id;
  }, usuarioId);
}

export async function editarHermano(
  ctx: Contexto,
  id: number,
  formulario: DatosHermanoCompletos,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'hermano_editar');

    try {
      await actualizarHermano(tx, id, comoDatos(formulario));
    } catch (error) {
      traducirError(error);
    }

    await asignarCargo(tx, ctx.anio, id, formulario.cargo_id, usuarioId);

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'hermano_edicion',
      entidad: 'hermano',
      entidadId: id,
      detalle: { nombre: formulario.nombre_completo, grado: formulario.grado },
    });
  }, usuarioId);
}

export async function darDeBaja(
  ctx: Contexto,
  id: number,
  datos: { fecha_baja: string; motivo_baja: string; notas_baja?: string | undefined },
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'hermano_baja');

    const actual = await tx.unaFila<{ fecha_ingreso: string; estatus: string }>(
      'select fecha_ingreso, estatus from hermano where id = $1 for update',
      [id],
    );
    if (!actual) throw new ErrorDeNegocio('El hermano ya no está en el padrón.');
    if (actual.estatus === 'baja') {
      throw new ErrorDeNegocio('Ese hermano ya está dado de baja.');
    }
    if (datos.fecha_baja < actual.fecha_ingreso) {
      throw new ErrorDeNegocio(
        'La fecha de baja no puede ser anterior a la de ingreso.',
        'fecha_baja',
      );
    }

    await cambiarEstatus(tx, id, { fecha: datos.fecha_baja, motivo: datos.motivo_baja });

    /* El cargo del año se libera: un hermano de baja no ocupa cargo. */
    await asignarCargo(tx, ctx.anio, id, null, usuarioId);

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'hermano_baja',
      entidad: 'hermano',
      entidadId: id,
      detalle: {
        fecha: datos.fecha_baja,
        motivo: datos.motivo_baja,
        notas: datos.notas_baja ?? null,
      },
    });
  }, usuarioId);
}

export async function reactivarHermano(ctx: Contexto, id: number): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'hermano_reactivar');
    await cambiarEstatus(tx, id, null);
    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'hermano_reactivacion',
      entidad: 'hermano',
      entidadId: id,
    });
  }, usuarioId);
}

/**
 * Registra un aumento de salario, una exaltación o cualquier otro evento de
 * grado, y actualiza el grado vigente si el evento es el más reciente.
 */
export async function agregarEventoGrado(
  ctx: Contexto,
  id: number,
  datos: { tipo_evento: string; fecha: string; grado: Grado; notas_evento?: string | undefined },
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'hermano_grado');

    await registrarEventoGrado(
      tx,
      id,
      {
        grado: datos.grado,
        fecha: datos.fecha,
        tipoEvento: datos.tipo_evento,
        notas: datos.notas_evento,
      },
      usuarioId,
    );

    /* El grado vigente es el del evento más reciente del historial. */
    await tx.consulta(
      `update hermano h set grado = (
         select hg.grado from hermano_grado hg
          where hg.hermano_id = h.id
          order by hg.fecha desc, hg.id desc
          limit 1
       )
       where h.id = $1`,
      [id],
    );

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'hermano_evento_grado',
      entidad: 'hermano',
      entidadId: id,
      detalle: { tipo: datos.tipo_evento, fecha: datos.fecha, grado: datos.grado },
    });
  }, usuarioId);
}
