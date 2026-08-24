/*
 * Exportación al sitio público.
 *
 * Esta es la prueba más importante en términos de privacidad: ese archivo termina
 * publicado en internet, así que falla si alguna vez aparece una clave que no
 * debería cruzar la frontera.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { crearHermano, enPrueba } from './ayuda.mjs';
import { ordenarCuadro } from '../scripts/exportar-cuadro.mjs';

const CLAVES_PERMITIDAS = new Set([
  'anio',
  'anioVulgar',
  'venerableMaestro',
  'primerVigilante',
  'segundoVigilante',
  'orador',
  'secretario',
  'tesorero',
  'oficiales',
  'maestros',
  'companeros',
  'aprendices',
]);

/** Nada de lo que sigue debe aparecer nunca en el archivo publicado. */
const PROHIBIDO = [
  'correo',
  'telefono',
  'fecha_ingreso',
  'fecha_iniciacion',
  'fecha_afiliacion',
  'notas',
  'estatus',
  'monto',
  'capita',
  'adeudo',
  'id',
];

test('el cuadro exportado solo lleva las claves publicables', async () => {
  await enPrueba(async ({ cliente }) => {
    const { rows } = await cliente.query(
      'select documento from v_cuadro_json where anio = 2026',
    );
    for (const clave of Object.keys(rows[0].documento)) {
      assert.ok(
        CLAVES_PERMITIDAS.has(clave),
        `la clave "${clave}" no debería publicarse en el sitio`,
      );
    }
  });
});

test('ningún dato sensible se cuela en el JSON', async () => {
  await enPrueba(async ({ cliente }) => {
    const id = await crearHermano(cliente, 'Prueba Privacidad', '2025-12-31');
    await cliente.query(
      `update hermano set correo = 'privado@ejemplo.mx', telefono = '5555555555',
              notas = 'dato reservado' where id = $1`,
      [id],
    );

    const { rows } = await cliente.query(
      'select documento::text as texto from v_cuadro_json where anio = 2026',
    );
    const texto = rows[0].texto.toLowerCase();

    for (const prohibido of PROHIBIDO) {
      assert.ok(
        !texto.includes(`"${prohibido}"`),
        `el JSON publicado contiene la clave "${prohibido}"`,
      );
    }
    assert.ok(!texto.includes('privado@ejemplo.mx'), 'se publicó un correo');
    assert.ok(!texto.includes('5555555555'), 'se publicó un teléfono');
    assert.ok(!texto.includes('dato reservado'), 'se publicaron notas internas');
    assert.ok(texto.includes('prueba privacidad'), 'el nombre sí debía publicarse');
  });
});

test('los maestros con cargo no se repiten en la columna de maestros', async () => {
  await enPrueba(async ({ cliente }) => {
    const conCargo = await crearHermano(cliente, 'Prueba Con Cargo', '2025-12-31');
    const sinCargo = await crearHermano(cliente, 'Prueba Sin Cargo', '2025-12-31');

    const { rows: cargo } = await cliente.query(
      "select id from cargo where clave = 'hospitalario'",
    );
    await cliente.query(
      `insert into cuadro_asignacion (anio, cargo_id, hermano_id, orden)
       values (2026, $1, $2, 15)`,
      [cargo[0].id, conCargo],
    );

    const { rows } = await cliente.query(
      'select documento from v_cuadro_json where anio = 2026',
    );
    const doc = rows[0].documento;

    assert.ok(
      doc.oficiales.some((o) => o.nombre === 'Prueba Con Cargo'),
      'el hermano con cargo debe aparecer en oficiales',
    );
    assert.ok(
      !doc.maestros.includes('Prueba Con Cargo'),
      'el sitio arma la columna de maestros uniendo dignatarios, oficiales y este ' +
        'arreglo: repetirlo aquí rompe esa intención',
    );
    assert.ok(
      doc.maestros.includes('Prueba Sin Cargo'),
      'el maestro sin cargo sí va en el arreglo',
    );
  });
});

test('un hermano de baja sale del cuadro publicado', async () => {
  await enPrueba(async ({ cliente }) => {
    const id = await crearHermano(cliente, 'Prueba De Baja', '2025-12-31');
    const { rows: antes } = await cliente.query(
      'select documento from v_cuadro_json where anio = 2026',
    );
    assert.ok(antes[0].documento.maestros.includes('Prueba De Baja'));

    await cliente.query(
      `update hermano set estatus = 'baja', fecha_baja = '2026-06-30',
              motivo_baja = 'plancha_de_quite' where id = $1`,
      [id],
    );

    const { rows: despues } = await cliente.query(
      'select documento from v_cuadro_json where anio = 2026',
    );
    assert.ok(!despues[0].documento.maestros.includes('Prueba De Baja'));
  });
});

test('ordenarCuadro respeta el orden del sitio y rechaza claves de más', () => {
  const ordenado = ordenarCuadro({
    aprendices: ['C'],
    anio: 2026,
    maestros: [],
    anioVulgar: '2026 E∴V∴',
    companeros: ['B'],
    oficiales: [],
  });
  assert.deepEqual(Object.keys(ordenado), [
    'anio',
    'anioVulgar',
    'oficiales',
    'maestros',
    'companeros',
    'aprendices',
  ]);

  assert.throws(
    () => ordenarCuadro({ anio: 2026, correo: 'privado@ejemplo.mx' }),
    /no se publican/i,
  );
});
