/*
 * Casos de uso del dominio Gran Tesorería.
 *
 * La separación central: la membresía es un hecho administrativo, la obligación
 * es lo exigible, el pago es dinero que sale por el libro de caja, y la
 * aplicación dice qué pago cubre qué obligación. Nada de eso se infiere del
 * padrón interno ni de las cápitas que los hermanos pagan a Masada.
 */
import { guardarComprobante } from '../archivos';
import { registrarEn } from '../bitacora';
import { consumirNonce } from '../csrf';
import { enTransaccion, unaFila } from '../db';
import { conceptoPorClave } from '../datos/conceptos';
import { insertarEgreso } from '../datos/egresos';
import { insertarTarifaGT, type ConceptoGT, type TipoObligacion } from '../datos/gt';
import { formatoMXN } from '../dinero';
import { ErrorDeNegocio } from '../errores';
import { hoyISO } from '../fechas';
import type { Sesion } from '../sesion';

interface Contexto {
  sesion: Sesion;
  nonce: string;
  idPeticion: string;
}

function comoErrorDeNegocio(error: unknown, campo?: string): never {
  const e = error as { code?: string; message?: string };
  if (e.code === 'P0001') throw new ErrorDeNegocio(e.message ?? 'No se pudo completar.', campo);
  throw error;
}

// ── Tarifas GT ───────────────────────────────────────────────────────────────

export async function capturarTarifaGT(
  ctx: Contexto,
  datos: {
    concepto: ConceptoGT;
    descripcion?: string | undefined;
    monto: number;
    vigente_desde: string;
  },
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  if (datos.vigente_desde < hoyISO()) {
    throw new ErrorDeNegocio(
      'Las tarifas no aplican en retroactivo: la vigencia empieza hoy o después.',
      'vigente_desde',
    );
  }

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'gt_tarifa');
    const id = await insertarTarifaGT(
      tx,
      {
        concepto: datos.concepto,
        descripcion: datos.descripcion,
        montoCentavos: datos.monto,
        vigenciaDesde: datos.vigente_desde,
      },
      usuarioId,
    );
    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'gt_tarifa_capturada',
      entidad: 'gt_tarifa',
      entidadId: id,
      detalle: { concepto: datos.concepto, monto: formatoMXN(datos.monto) },
    });
  }, usuarioId);
}

// ── Membresías ───────────────────────────────────────────────────────────────

export async function crearMembresia(
  ctx: Contexto,
  datos: {
    fecha_documento: string;
    fecha_recepcion?: string | undefined;
    periodo_referencia: string;
    observaciones?: string | undefined;
  },
  documento: File | undefined,
): Promise<number> {
  const usuarioId = ctx.sesion.usuario.id;

  let archivoId: number | null = null;
  if (documento) {
    const guardado = await guardarComprobante(documento, usuarioId, datos.fecha_documento);
    archivoId = guardado.id;
  }

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'gt_membresia');
    const fila = await tx.laFila<{ id: number }>(
      `insert into gt_membresia
         (fecha_documento, fecha_recepcion, periodo_referencia, archivo_id, observaciones,
          creado_por)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        datos.fecha_documento,
        datos.fecha_recepcion ?? null,
        `${datos.periodo_referencia}-01`,
        archivoId,
        datos.observaciones ?? null,
        usuarioId,
      ],
    );
    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'gt_membresia_registrada',
      entidad: 'gt_membresia',
      entidadId: fila.id,
      detalle: { periodo: datos.periodo_referencia, con_documento: archivoId !== null },
    });
    return fila.id;
  }, usuarioId);
}

/** Renglón tal como lo reporta la Gran Tesorería. La liga con el padrón llega después. */
export async function agregarRenglonMembresia(
  ctx: Contexto,
  membresiaId: number,
  datos: {
    nombre_reportado: string;
    clave_mason?: string | undefined;
    grado_reportado?: string | undefined;
    estatus_reportado?: string | undefined;
    genera_capita: boolean;
    hermano_id: number | null;
  },
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'gt_renglon');
    await tx.consulta(
      `insert into gt_membresia_hermano
         (membresia_id, hermano_id, nombre_reportado, clave_mason_reportada,
          grado_reportado, estatus_reportado, genera_capita, conciliado, creado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        membresiaId,
        datos.hermano_id,
        datos.nombre_reportado,
        datos.clave_mason ?? null,
        datos.grado_reportado ?? null,
        datos.estatus_reportado ?? null,
        datos.genera_capita,
        datos.hermano_id !== null,
        usuarioId,
      ],
    );
    if (datos.hermano_id !== null) {
      await sincronizarEstatusGT(tx, datos.hermano_id, membresiaId, usuarioId);
    }
    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'gt_membresia_renglon',
      entidad: 'gt_membresia',
      entidadId: membresiaId,
      detalle: { nombre: datos.nombre_reportado, ligado: datos.hermano_id !== null },
    });
  }, usuarioId);
}

/** Liga un renglón reportado con un hermano del padrón. Es conciliación, no edición. */
export async function ligarRenglonMembresia(
  ctx: Contexto,
  renglonId: number,
  hermanoId: number | null,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'gt_ligar');
    const fila = await tx.unaFila<{ membresia_id: number; nombre_reportado: string }>(
      `update gt_membresia_hermano
          set hermano_id = $2, conciliado = ($2 is not null)
        where id = $1
        returning membresia_id, nombre_reportado`,
      [renglonId, hermanoId],
    );
    if (!fila) throw new ErrorDeNegocio('Ese renglón ya no existe.');

    if (hermanoId !== null) {
      await sincronizarEstatusGT(tx, hermanoId, fila.membresia_id, usuarioId);
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'gt_membresia_ligada',
      entidad: 'gt_membresia_hermano',
      entidadId: renglonId,
      detalle: { nombre: fila.nombre_reportado, hermano_id: hermanoId },
    });
  }, usuarioId);
}

/*
 * Aparecer en una membresía es la evidencia de que GT reconoce al hermano: el
 * estatus manual se sincroniza al ligar, sin tocar el padrón interno.
 */
async function sincronizarEstatusGT(
  tx: Parameters<Parameters<typeof enTransaccion>[0]>[0],
  hermanoId: number,
  membresiaId: number,
  usuarioId: number,
): Promise<void> {
  await tx.consulta(
    `insert into hermano_gran_tesoreria
       (hermano_id, estatus, fecha_registro, observaciones, creado_por, actualizado_por)
     select $1, 'activo', m.fecha_documento,
            'Ligado desde la membresía del ' || to_char(m.periodo_referencia, 'YYYY-MM'),
            $3, $3
       from gt_membresia m where m.id = $2
     on conflict (hermano_id) do update
       set estatus = 'activo',
           fecha_registro = coalesce(hermano_gran_tesoreria.fecha_registro,
                                     excluded.fecha_registro),
           observaciones = excluded.observaciones,
           actualizado_por = $3`,
    [hermanoId, membresiaId, usuarioId],
  );
}

// ── Obligaciones ─────────────────────────────────────────────────────────────

export async function capturarObligacion(
  ctx: Contexto,
  datos: {
    tipo: TipoObligacion;
    periodo_desde: string;
    periodo_hasta: string;
    fecha_documento: string;
    monto_reportado: number;
    monto_esperado?: number | null;
    membresia_id?: number | null;
    hermano_id?: number | null;
    observaciones?: string | undefined;
    tramite_clase?: string | null;
    tramite_descripcion?: string | undefined;
  },
  documentoCalculo: File | undefined,
): Promise<{ id: number; folio: string }> {
  const usuarioId = ctx.sesion.usuario.id;

  if (datos.periodo_hasta < datos.periodo_desde) {
    throw new ErrorDeNegocio('El mes final no puede ser anterior al inicial.', 'periodo_hasta');
  }
  if (datos.tipo === 'tramite' && !datos.hermano_id) {
    throw new ErrorDeNegocio(
      'Un trámite (afiliación, iniciación, grado) es de un hermano concreto: indícalo.',
      'hermano_id',
    );
  }
  if (datos.tipo === 'tramite' && !datos.tramite_clase) {
    throw new ErrorDeNegocio('Indica qué trámite es.', 'tramite_clase');
  }
  if (datos.tramite_clase === 'otro' && !datos.tramite_descripcion) {
    throw new ErrorDeNegocio(
      'Un trámite administrativo lleva su nombre, como "Carta de regularidad para grados filosóficos".',
      'tramite_descripcion',
    );
  }

  let archivoId: number | null = null;
  if (documentoCalculo) {
    const guardado = await guardarComprobante(documentoCalculo, usuarioId, datos.fecha_documento);
    archivoId = guardado.id;
  }

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'gt_obligacion');

    const anio = Number(datos.periodo_desde.slice(0, 4));
    const folio = await tx.laFila<{ folio: string }>(
      'select fn_gt_folio_obligacion($1, $2) as folio',
      [anio, datos.tipo],
    );

    const fila = await tx.laFila<{ id: number }>(
      `insert into gt_obligacion
         (folio, tipo, periodo_desde, periodo_hasta, fecha_documento,
          monto_reportado_centavos, monto_esperado_centavos, membresia_id,
          documento_calculo_id, hermano_id, observaciones,
          tramite_clase, tramite_descripcion, creado_por, actualizado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
       returning id`,
      [
        folio.folio,
        datos.tipo,
        `${datos.periodo_desde}-01`,
        `${datos.periodo_hasta}-01`,
        datos.fecha_documento,
        datos.monto_reportado,
        datos.monto_esperado ?? null,
        datos.membresia_id ?? null,
        archivoId,
        datos.hermano_id ?? null,
        datos.observaciones ?? null,
        datos.tramite_clase ?? null,
        datos.tramite_descripcion ?? null,
        usuarioId,
      ],
    );

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'gt_obligacion_capturada',
      entidad: 'gt_obligacion',
      entidadId: fila.id,
      detalle: {
        folio: folio.folio,
        tipo: datos.tipo,
        monto: formatoMXN(datos.monto_reportado),
        esperado: datos.monto_esperado != null ? formatoMXN(datos.monto_esperado) : null,
      },
    });

    return { id: fila.id, folio: folio.folio };
  }, usuarioId);
}

export async function agregarDetalleObligacion(
  ctx: Contexto,
  obligacionId: number,
  datos: {
    concepto: string;
    cantidad: number;
    tarifa?: number | null;
    subtotal: number;
    hermano_id?: number | null;
    periodo?: string | undefined;
    descripcion?: string | undefined;
  },
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'gt_detalle');
    const obligacion = await tx.unaFila<{ estatus: string; folio: string }>(
      'select estatus, folio from gt_obligacion where id = $1 for update',
      [obligacionId],
    );
    if (!obligacion) throw new ErrorDeNegocio('Esa obligación no existe.');
    if (obligacion.estatus === 'cancelada') {
      throw new ErrorDeNegocio('La obligación está cancelada.');
    }

    await tx.consulta(
      `insert into gt_obligacion_detalle
         (obligacion_id, concepto, cantidad, tarifa_centavos, subtotal_centavos,
          hermano_id, periodo, descripcion, creado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        obligacionId,
        datos.concepto,
        datos.cantidad,
        datos.tarifa ?? null,
        datos.subtotal,
        datos.hermano_id ?? null,
        datos.periodo ? `${datos.periodo}-01` : null,
        datos.descripcion ?? null,
        usuarioId,
      ],
    );

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'gt_obligacion_detalle',
      entidad: 'gt_obligacion',
      entidadId: obligacionId,
      detalle: { folio: obligacion.folio, concepto: datos.concepto, subtotal: formatoMXN(datos.subtotal) },
    });
  }, usuarioId);
}

export async function cancelarObligacion(
  ctx: Contexto,
  obligacionId: number,
  motivo: string,
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'gt_cancelar');
    try {
      const fila = await tx.unaFila<{ folio: string }>(
        `update gt_obligacion
            set estatus = 'cancelada', motivo_cancelacion = $2
          where id = $1 and estatus <> 'cancelada'
          returning folio`,
        [obligacionId, motivo],
      );
      if (!fila) throw new ErrorDeNegocio('Esa obligación no existe o ya estaba cancelada.');
      await registrarEn(tx, {
        usuarioId,
        idPeticion: ctx.idPeticion,
        accion: 'gt_obligacion_cancelada',
        entidad: 'gt_obligacion',
        entidadId: obligacionId,
        detalle: { folio: fila.folio, motivo },
      });
    } catch (error) {
      comoErrorDeNegocio(error, 'motivo');
    }
  }, usuarioId);
}

/**
 * Genera el egreso que pagará una o varias obligaciones. El egreso lleva las
 * dos firmas de siempre; al registrar su entrega, el pago GT y sus aplicaciones
 * se materializan solos.
 */
export async function generarEgresoDePago(
  ctx: Contexto,
  obligacionIds: number[],
): Promise<{ egresoId: number; folio: string }> {
  const usuarioId = ctx.sesion.usuario.id;

  if (obligacionIds.length === 0) {
    throw new ErrorDeNegocio('Elige al menos una obligación por pagar.');
  }

  const concepto = await conceptoPorClave('gran_tesoreria');
  if (!concepto) {
    throw new Error('Falta el concepto gran_tesoreria en el catálogo.');
  }

  return enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, 'gt_generar_egreso');

    const obligaciones = await tx.consulta<{
      id: number;
      folio: string;
      tipo: string;
      saldo: number;
    }>(
      `select o.id, o.folio, o.tipo,
              (o.monto_reportado_centavos
                - coalesce((select sum(a.monto_centavos) from gt_pago_aplicacion a
                             where a.obligacion_id = o.id), 0))::int as saldo
         from gt_obligacion o
        where o.id = any($1::bigint[])
          and o.estatus in ('pendiente_pago', 'parcialmente_pagada')
        for update`,
      [obligacionIds],
    );
    if (obligaciones.length !== obligacionIds.length) {
      throw new ErrorDeNegocio(
        'Alguna de las obligaciones elegidas ya no está pendiente de pago.',
      );
    }

    /* Una obligación no puede estar en dos egresos vivos a la vez. */
    const enTramite = await tx.consulta<{ folio: string }>(
      `select e.folio
         from egreso_gt_obligacion l
         join egreso e on e.id = l.egreso_id
        where l.obligacion_id = any($1::bigint[])
          and e.estado in ('registrado', 'autorizado')`,
      [obligacionIds],
    );
    if (enTramite.length > 0) {
      throw new ErrorDeNegocio(
        `Ya hay un egreso en trámite (${enTramite[0]!.folio}) para alguna de esas obligaciones.`,
      );
    }

    const total = obligaciones.reduce((s, o) => s + o.saldo, 0);
    if (total <= 0) throw new ErrorDeNegocio('Las obligaciones elegidas ya no tienen saldo.');

    const creado = await insertarEgreso(
      tx,
      {
        fecha_solicitud: hoyISO(),
        concepto_id: concepto.id,
        beneficiario: 'M∴R∴G∴L∴ Valle de México',
        descripcion: `Pago a la Gran Tesorería: ${obligaciones.map((o) => o.folio).join(', ')}`,
        hermano_id: null,
        monto_solicitado_centavos: total,
        requiere_comprobacion: false,
        notas: undefined,
      },
      usuarioId,
    );

    for (const o of obligaciones) {
      await tx.consulta(
        `insert into egreso_gt_obligacion (egreso_id, obligacion_id, monto_centavos)
         values ($1, $2, $3)`,
        [creado.id, o.id, o.saldo],
      );
    }

    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: 'gt_egreso_generado',
      entidad: 'egreso',
      entidadId: creado.id,
      detalle: {
        folio: creado.folio,
        obligaciones: obligaciones.map((o) => o.folio),
        monto: formatoMXN(total),
      },
    });

    return { egresoId: creado.id, folio: creado.folio };
  }, usuarioId);
}

// ── Registros externos por hermano ───────────────────────────────────────────

export async function actualizarRegistroExterno(
  ctx: Contexto,
  hermanoId: number,
  organismo: 'gran_secretaria' | 'gran_tesoreria',
  datos: {
    estatus: 'pendiente' | 'activo' | 'baja' | 'desconocido';
    fecha_registro?: string | undefined;
    fecha_efectiva?: string | undefined;
    fecha_baja?: string | undefined;
    observaciones?: string | undefined;
  },
): Promise<void> {
  const usuarioId = ctx.sesion.usuario.id;
  const tabla =
    organismo === 'gran_secretaria' ? 'hermano_gran_secretaria' : 'hermano_gran_tesoreria';

  const hermano = await unaFila<{ nombre_completo: string }>(
    'select nombre_completo from hermano where id = $1',
    [hermanoId],
  );
  if (!hermano) throw new ErrorDeNegocio('Ese hermano no está en el padrón.');

  await enTransaccion(async (tx) => {
    await consumirNonce(tx, ctx.nonce, ctx.sesion.idHash, `registro_${organismo}`);
    /* El nombre de la tabla viene de una lista cerrada propia, no del usuario. */
    await tx.consulta(
      `insert into ${tabla}
         (hermano_id, estatus, fecha_registro, fecha_efectiva, fecha_baja, observaciones,
          creado_por, actualizado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $7)
       on conflict (hermano_id) do update
         set estatus = excluded.estatus,
             fecha_registro = excluded.fecha_registro,
             fecha_efectiva = excluded.fecha_efectiva,
             fecha_baja = excluded.fecha_baja,
             observaciones = excluded.observaciones,
             actualizado_por = $7`,
      [
        hermanoId,
        datos.estatus,
        datos.fecha_registro ?? null,
        datos.fecha_efectiva ?? null,
        datos.fecha_baja ?? null,
        datos.observaciones ?? null,
        usuarioId,
      ],
    );
    await registrarEn(tx, {
      usuarioId,
      idPeticion: ctx.idPeticion,
      accion: `registro_externo_${organismo}`,
      entidad: 'hermano',
      entidadId: hermanoId,
      detalle: { hermano: hermano.nombre_completo, estatus: datos.estatus },
    });
  }, usuarioId);
}
