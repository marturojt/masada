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
  insertarCandidato,
  insertarHermano,
  registrarEventoGrado,
  type CandidatoPara,
  type DatosHermano,
} from '../datos/hermanos';
import { insertarCuota } from '../datos/cuotas';
import { formatoMXN } from '../dinero';
import { hoyISO } from '../fechas';
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

// ─────────────────────────────────────────────────────────────────────────────
// Candidatos
// ─────────────────────────────────────────────────────────────────────────────

/*
 * Un candidato nace en el padrón antes de su ceremonia: sin grado, sin fecha de
 * ingreso y sin cápitas. Si se captura su cuota, nace también lo que debe, y
 * cualquier pago de esa cuota se le aplica solo.
 */
export async function crearCandidato(
  ctx: Contexto,
  datos: {
    nombre_completo: string;
    candidato_para: CandidatoPara;
    fecha_programada?: string | undefined;
    correo?: string | undefined;
    telefono?: string | undefined;
    notas?: string | undefined;
    cuota?: number | null | undefined;
  },
): Promise<number> {
  const usuarioId = ctx.sesion.usuario.id;

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'candidato_nuevo');

    let id: number;
    try {
      id = await insertarCandidato(tx, datos, usuarioId);
    } catch (error) {
      traducirError(error);
    }

    if (datos.cuota) {
      await insertarCuota(
        tx,
        {
          hermanoId: id,
          tipoEvento: datos.candidato_para,
          montoCentavos: datos.cuota,
          fecha: hoyISO(),
          notas: 'Registrada al dar de alta al candidato',
        },
        usuarioId,
      );
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'candidato_alta',
      entidad: 'hermano',
      entidadId: id,
      detalle: {
        nombre: datos.nombre_completo,
        para: datos.candidato_para,
        fecha_programada: datos.fecha_programada ?? null,
        cuota: datos.cuota ? formatoMXN(datos.cuota) : null,
      },
    });

    return id;
  }, usuarioId);
}

/**
 * El día de la ceremonia el candidato pasa a hermano activo: iniciado entra
 * como aprendiz, afiliado con el grado que trae. Su fecha de ingreso es la de
 * la ceremonia y desde ahí corren sus cápitas. Lo que ya tenía (cuotas, pagos,
 * trámite GT) se queda con él, porque es la misma fila.
 */
export async function ingresarCandidato(
  ctx: Contexto,
  id: number,
  datos: { fecha: string; grado?: Grado | undefined },
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  if (datos.fecha > hoyISO()) {
    throw new ErrorDeNegocio('La ceremonia no puede tener fecha futura: se registra cuando ya pasó.', 'fecha');
  }

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'candidato_ingreso');

    const actual = await tx.unaFila<{ estatus: string; candidato_para: CandidatoPara; nombre_completo: string }>(
      'select estatus, candidato_para, nombre_completo from hermano where id = $1 for update',
      [id],
    );
    if (!actual || actual.estatus !== 'candidato') {
      throw new ErrorDeNegocio('Esa persona ya no es candidato.');
    }

    const esIniciacion = actual.candidato_para === 'iniciacion';
    const grado: Grado | undefined = esIniciacion ? 'aprendiz' : datos.grado;
    if (!grado) {
      throw new ErrorDeNegocio('Indica el grado con el que llega de su logia.', 'grado');
    }

    await tx.consulta(
      `update hermano
          set estatus = 'activo', grado = $2::grado_masonico, fecha_ingreso = $3,
              motivo_ingreso = candidato_para,
              fecha_iniciacion = case when candidato_para = 'iniciacion' then $3::date
                                      else fecha_iniciacion end,
              fecha_afiliacion = case when candidato_para = 'afiliacion' then $3::date
                                      else fecha_afiliacion end,
              fecha_programada = null, actualizado_por = $4
        where id = $1`,
      [id, grado, datos.fecha, usuarioId],
    );

    await registrarEventoGrado(
      tx,
      id,
      { grado, fecha: datos.fecha, tipoEvento: actual.candidato_para },
      usuarioId,
    );

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: esIniciacion ? 'candidato_iniciado' : 'candidato_afiliado',
      entidad: 'hermano',
      entidadId: id,
      detalle: { nombre: actual.nombre_completo, fecha: datos.fecha, grado },
    });
  }, usuarioId);
}

/** El candidato desiste, o vuelve a serlo. No se borra: sus pagos lo siguen. */
export async function cambiarCandidatura(
  ctx: Contexto,
  id: number,
  desiste: boolean,
  motivo?: string | undefined,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'candidato_estatus');
    const fila = await tx.unaFila<{ nombre_completo: string }>(
      `update hermano set estatus = $2, actualizado_por = $3
        where id = $1 and estatus = $4
        returning nombre_completo`,
      [id, desiste ? 'desistio' : 'candidato', usuarioId, desiste ? 'candidato' : 'desistio'],
    );
    if (!fila) throw new ErrorDeNegocio('Ese candidato ya cambió de estatus.');
    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: desiste ? 'candidato_desistio' : 'candidato_retomado',
      entidad: 'hermano',
      entidadId: id,
      detalle: { nombre: fila.nombre_completo, motivo: motivo ?? null },
    });
  }, usuarioId);
}
