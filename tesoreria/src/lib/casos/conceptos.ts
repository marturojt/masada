/*
 * Administración del catálogo de conceptos.
 *
 * Los conceptos que el tesorero crea son siempre de tipo_especial 'otro': los que
 * llevan lógica propia (cápitas, Gran Tesorería, devoluciones) se siembran en una
 * migración porque el código depende de su clave.
 */
import { registrarEn } from '../bitacora';
import { consumirNonce } from '../csrf';
import { enTransaccion } from '../db';
import {
  actualizarConcepto,
  cambiarActivo,
  insertarConcepto,
  obtenerConcepto,
  type DatosConcepto,
} from '../datos/conceptos';
import { ErrorDeNegocio } from '../errores';
import type { DatosConceptoFormulario } from '../esquemas/movimiento';
import type { Sesion } from '../sesion';

interface Contexto {
  sesion: Sesion;
  nonce: string;
  idPeticion: string;
}

/** Clave estable derivada del nombre, sin acentos ni símbolos. */
function claveDe(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

const comoDatos = (f: DatosConceptoFormulario): DatosConcepto => ({
  nombre: f.nombre,
  naturaleza: f.naturaleza,
  requiere_hermano: f.requiere_hermano,
  requiere_comprobante: f.requiere_comprobante,
  por_comprobar_por_defecto: f.por_comprobar_por_defecto,
  orden: f.orden,
  notas: f.notas,
});

export async function crearConcepto(
  ctx: Contexto,
  formulario: DatosConceptoFormulario,
): Promise<number> {
  const usuarioId = ctx.sesion.usuario.id;
  const base = claveDe(formulario.nombre);
  if (base.length === 0) {
    throw new ErrorDeNegocio('Ese nombre no sirve como concepto, usa letras.', 'nombre');
  }

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'concepto_nuevo');

    /* Si la clave ya existe, se le agrega un sufijo hasta que sea única. */
    let clave = base;
    for (let intento = 2; intento < 50; intento += 1) {
      const choque = await tx.unaFila<{ id: number }>(
        'select id from concepto where clave = $1',
        [clave],
      );
      if (!choque) break;
      clave = `${base}_${intento}`.slice(0, 40);
    }

    const id = await insertarConcepto(tx, clave, comoDatos(formulario), usuarioId);

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'concepto_alta',
      entidad: 'concepto',
      entidadId: id,
      detalle: { clave, nombre: formulario.nombre, naturaleza: formulario.naturaleza },
    });

    return id;
  }, usuarioId);
}

export async function editarConcepto(
  ctx: Contexto,
  id: number,
  formulario: DatosConceptoFormulario,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;
  const previo = await obtenerConcepto(id);
  if (!previo) throw new ErrorDeNegocio('Ese concepto ya no existe.');

  if (previo.naturaleza !== formulario.naturaleza) {
    throw new ErrorDeNegocio(
      'No se puede cambiar un concepto de ingreso a egreso ni al revés: los ' +
        'movimientos ya registrados dejarían de cuadrar. Crea otro concepto.',
      'naturaleza',
    );
  }

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'concepto_editar');
    await actualizarConcepto(tx, id, comoDatos(formulario));
    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'concepto_edicion',
      entidad: 'concepto',
      entidadId: id,
      detalle: { nombre: formulario.nombre },
    });
  }, usuarioId);
}

export async function activarConcepto(
  ctx: Contexto,
  id: number,
  activo: boolean,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;
  const previo = await obtenerConcepto(id);
  if (!previo) throw new ErrorDeNegocio('Ese concepto ya no existe.');

  if (!activo && !previo.seleccionable) {
    throw new ErrorDeNegocio(
      `"${previo.nombre}" lo usa el sistema por su cuenta, no se puede desactivar.`,
    );
  }

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'concepto_activar');
    await cambiarActivo(tx, id, activo);
    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: activo ? 'concepto_activado' : 'concepto_desactivado',
      entidad: 'concepto',
      entidadId: id,
      detalle: { nombre: previo.nombre },
    });
  }, usuarioId);
}
