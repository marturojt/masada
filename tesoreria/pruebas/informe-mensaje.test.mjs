/*
 * Mensaje del tesorero para el informe de tenida: vive aparte del corte, así
 * que se escribe aunque el mes esté cerrado, y no admite textos vacíos.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { debeFallar, enPrueba } from './ayuda.mjs';

const guardar = (cliente, periodo, mensaje, usuarioId) =>
  cliente.query(
    `insert into informe_mensaje (periodo, ejercicio_anio, mensaje, creado_por, actualizado_por)
     values ($1, extract(year from $1::date)::int, $2, $3, $3)
     on conflict (periodo) do update set mensaje = excluded.mensaje`,
    [periodo, mensaje, usuarioId],
  );

test('el mensaje se escribe y se corrige aunque el corte esté cerrado', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    await cliente.query('select fn_cerrar_corte($1)', ['2026-01-01']);
    await guardar(cliente, '2026-01-01', 'Gracias a todos por ponerse al corriente.', tesorero);
    await guardar(cliente, '2026-01-01', 'Mensaje corregido.', tesorero);

    const { rows } = await cliente.query(
      "select mensaje from informe_mensaje where periodo = '2026-01-01'",
    );
    assert.equal(rows[0].mensaje, 'Mensaje corregido.');
  });
});

test('el mensaje no puede ir vacío ni en un día que no sea primero de mes', async () => {
  await enPrueba(async ({ cliente, tesorero }) => {
    await debeFallar(
      cliente,
      () => guardar(cliente, '2026-02-01', '   ', tesorero),
      /informe_mensaje_no_vacio/,
    );
    await debeFallar(
      cliente,
      () => guardar(cliente, '2026-02-15', 'Hola', tesorero),
      /informe_mensaje_dia_uno/,
    );
  });
});
