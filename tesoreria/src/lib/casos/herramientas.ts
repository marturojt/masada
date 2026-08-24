/*
 * Operaciones de mantenimiento: saldo de apertura del ejercicio y cambio de la
 * propia contraseña.
 */
import { hashearContrasena, revisarFortaleza, verificarContrasena } from '../auth';
import { registrarEn } from '../bitacora';
import { consumirNonce } from '../csrf';
import { enTransaccion, unaFila } from '../db';
import { formatoMXN } from '../dinero';
import { ErrorDeNegocio } from '../errores';
import type { Sesion } from '../sesion';

interface Contexto {
  sesion: Sesion;
  nonce: string;
  idPeticion: string;
}

/**
 * El saldo de apertura de 2026 lo captura el tesorero: de años anteriores no hay
 * información recuperable. De 2027 en adelante debería salir del corte de
 * diciembre, por eso solo se deja tocar mientras el ejercicio no tenga cortes
 * cerrados.
 */
export async function actualizarApertura(
  ctx: Contexto,
  anio: number,
  bancoCentavos: number,
  efectivoCentavos: number,
  notas: string | undefined,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'ejercicio_apertura');

    const cerrados = await tx.laFila<{ total: number }>(
      `select count(*)::int as total from corte_mensual
        where ejercicio_anio = $1 and estado = 'cerrado'`,
      [anio],
    );
    if (cerrados.total > 0) {
      throw new ErrorDeNegocio(
        `El ejercicio ${anio} ya tiene ${cerrados.total} mes(es) cerrados. Cambiar el ` +
          'saldo de apertura movería todos los saldos ya leídos en tenida: primero hay ' +
          'que reabrir los cortes.',
        'saldo_apertura',
      );
    }

    const previo = await tx.laFila<{ banco: number; efectivo: number }>(
      `select apertura_banco_centavos as banco, apertura_efectivo_centavos as efectivo
         from ejercicio where anio = $1`,
      [anio],
    );

    await tx.consulta(
      `update ejercicio
          set apertura_banco_centavos = $2, apertura_efectivo_centavos = $3,
              notas = coalesce($4, notas)
        where anio = $1`,
      [anio, bancoCentavos, efectivoCentavos, notas ?? null],
    );

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'ejercicio_apertura_actualizada',
      entidad: 'ejercicio',
      entidadId: anio,
      detalle: {
        banco_antes: formatoMXN(previo.banco),
        banco_despues: formatoMXN(bancoCentavos),
        efectivo_antes: formatoMXN(previo.efectivo),
        efectivo_despues: formatoMXN(efectivoCentavos),
        notas: notas ?? null,
      },
    });
  }, usuarioId);
}

/** Cambio de la propia contraseña. Revoca todas las sesiones, incluida la actual. */
export async function cambiarMiContrasena(
  ctx: Contexto,
  actual: string,
  nueva: string,
  repetida: string,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  if (nueva !== repetida) {
    throw new ErrorDeNegocio('Las dos contraseñas nuevas no coinciden.', 'nueva_repetida');
  }

  const problema = revisarFortaleza(nueva);
  if (problema) throw new ErrorDeNegocio(problema, 'nueva');

  const fila = await unaFila<{ hash_contrasena: string }>(
    'select hash_contrasena from usuario where id = $1',
    [usuarioId],
  );
  if (!fila) throw new ErrorDeNegocio('Tu usuario ya no existe.');

  const correcta = await verificarContrasena(actual, fila.hash_contrasena);
  if (!correcta) {
    throw new ErrorDeNegocio('La contraseña actual no es correcta.', 'actual');
  }

  const hash = await hashearContrasena(nueva);

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'contrasena_cambio');

    await tx.consulta('update usuario set hash_contrasena = $2 where id = $1', [
      usuarioId,
      hash,
    ]);

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'contrasena_rotada',
      entidad: 'usuario',
      entidadId: usuarioId,
      detalle: { origen: 'panel' },
    });

    /* Se revocan todas las sesiones: si alguien más la tenía, se cae también. */
    await tx.consulta('delete from sesion where usuario_id = $1', [usuarioId]);
  }, usuarioId);
}

/**
 * Abre el ejercicio siguiente. Las tarifas de cápita se heredan del año anterior
 * salvo que se indiquen otras, y el saldo de apertura se arrastra del corte de
 * diciembre: si diciembre aún no cierra, se completa solo cuando cierre.
 */
export async function abrirEjercicio(
  ctx: Contexto,
  anio: number,
  capitaMensualCentavos: number | null,
  capitaPromocionCentavos: number | null,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'ejercicio_abrir');

    await tx.consulta('select fn_abrir_ejercicio($1, $2, $3)', [
      anio,
      capitaMensualCentavos,
      capitaPromocionCentavos,
    ]);

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'ejercicio_abierto',
      entidad: 'ejercicio',
      entidadId: anio,
      detalle: {
        capita_mensual: capitaMensualCentavos ? formatoMXN(capitaMensualCentavos) : 'heredada',
        capita_promocion: capitaPromocionCentavos
          ? formatoMXN(capitaPromocionCentavos)
          : 'heredada',
      },
    });
  }, usuarioId);
}

/** Cierra un ejercicio. Exige los doce cortes cerrados; lo valida la base. */
export async function cerrarEjercicio(ctx: Contexto, anio: number): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'ejercicio_cerrar');
    await tx.consulta('select fn_cerrar_ejercicio($1)', [anio]);
    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'ejercicio_cerrado',
      entidad: 'ejercicio',
      entidadId: anio,
    });
  }, usuarioId);
}
