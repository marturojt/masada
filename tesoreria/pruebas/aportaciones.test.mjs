/*
 * Aportaciones: la monetaria es dinero de verdad con movimiento; la de especie
 * deja constancia con folio APO- y jamás toca el libro de caja.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { debeFallar, enPrueba } from './ayuda.mjs';

async function movimientoDonativo(cliente, usuarioId, monto = 50000) {
  const { rows: concepto } = await cliente.query(
    "select id from concepto where clave = 'donativo'",
  );
  const { rows } = await cliente.query(
    `insert into movimiento
       (fecha, ejercicio_anio, periodo, tipo, bolsa, concepto_id, monto_centavos,
        descripcion, creado_por)
     values ('2026-02-10', 2026, '2026-02-01', 'ingreso', 'efectivo', $1, $2,
             'Aportación de prueba', $3)
     returning id`,
    [concepto[0].id, monto, usuarioId],
  );
  return rows[0].id;
}

test('la aportación en especie lleva folio APO- y no mueve la caja', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const { rows: antes } = await cliente.query(
      "select count(*)::int as movimientos from movimiento",
    );

    const { rows: folio } = await cliente.query('select fn_folio_aportacion(2026) as folio');
    assert.match(folio[0].folio, /^APO-2026-\d{4}$/);

    await cliente.query(
      `insert into aportacion
         (tipo, folio, aportante_nombre, fecha, descripcion, cantidad, unidad,
          valor_estimado_centavos, creado_por)
       values ('especie', $1, 'Q∴H∴ Generoso', '2026-02-10', 'Sillas para el templo',
               10, 'piezas', 250000, $2)`,
      [folio[0].folio, tesorero],
    );

    /* Ni un movimiento nuevo: el libro de caja no se entera. */
    const { rows: despues } = await cliente.query(
      "select count(*)::int as movimientos from movimiento",
    );
    assert.equal(despues[0].movimientos, antes[0].movimientos);
  });
});

test('la monetaria exige movimiento y la especie lo prohíbe', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    /* Monetaria sin movimiento: rechazada. */
    await debeFallar(
      cliente,
      () =>
        cliente.query(
          `insert into aportacion (tipo, aportante_nombre, fecha, descripcion, creado_por)
           values ('monetaria', 'Alguien', '2026-02-10', 'Dinero sin rastro', $1)`,
          [tesorero],
        ),
      /aportacion_monetaria_con_movimiento/,
    );

    /* Especie con movimiento: rechazada. */
    const movimientoId = await movimientoDonativo(cliente, tesorero);
    const { rows: folio } = await cliente.query('select fn_folio_aportacion(2026) as folio');
    await debeFallar(
      cliente,
      () =>
        cliente.query(
          `insert into aportacion
             (tipo, folio, aportante_nombre, fecha, descripcion, cantidad,
              movimiento_id, creado_por)
           values ('especie', $1, 'Alguien', '2026-02-10', 'Especie con dinero', 1, $2, $3)`,
          [folio[0].folio, movimientoId, tesorero],
        ),
      /aportacion_monetaria_con_movimiento/,
    );

    /* Monetaria bien formada: con movimiento y sin folio propio. */
    await cliente.query(
      `insert into aportacion
         (tipo, aportante_nombre, fecha, descripcion, movimiento_id, creado_por)
       values ('monetaria', 'Q∴H∴ Aportante', '2026-02-10', 'Donativo para el ágape', $1, $2)`,
      [movimientoId, tesorero],
    );
  });
});

test('la especie sin cantidad no se registra', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const { rows: folio } = await cliente.query('select fn_folio_aportacion(2026) as folio');
    await debeFallar(
      cliente,
      () =>
        cliente.query(
          `insert into aportacion (tipo, folio, aportante_nombre, fecha, descripcion, creado_por)
           values ('especie', $1, 'Alguien', '2026-02-10', 'Algo sin cantidad', $2)`,
          [folio[0].folio, tesorero],
        ),
      /aportacion_especie_con_cantidad/,
    );
  });
});

test('lo esencial de una aportación no se altera ni se borra', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    const { rows: folio } = await cliente.query('select fn_folio_aportacion(2026) as folio');
    const { rows } = await cliente.query(
      `insert into aportacion
         (tipo, folio, aportante_nombre, fecha, descripcion, cantidad, creado_por)
       values ('especie', $1, 'Q∴H∴ Generoso', '2026-02-10', 'Vino para el ágape', 6, $2)
       returning id`,
      [folio[0].folio, tesorero],
    );
    /* La descripción se puede afinar, pero el aportante, la fecha, la cantidad
       y el valor son el hecho que la constancia ampara: no se tocan. */
    await debeFallar(
      cliente,
      () =>
        cliente.query("update aportacion set aportante_nombre = 'Otro' where id = $1", [
          rows[0].id,
        ]),
      /./,
    );
    await debeFallar(
      cliente,
      () => cliente.query('delete from aportacion where id = $1', [rows[0].id]),
      /no se borran/i,
    );
  });
});
