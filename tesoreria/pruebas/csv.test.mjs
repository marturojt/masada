/*
 * El analizador de CSV de la carga masiva: comillas, comas y saltos de línea
 * dentro de campos, BOM de Excel, CRLF, notas con # y filas vacías.
 * Node corre el .ts directo con su recorte de tipos, sin compilar.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { analizarCSV, aCSV } from '../src/lib/csv.ts';

test('separa columnas y respeta comillas con comas y saltos', () => {
  const { encabezados, filas } = analizarCSV(
    'nombre,notas\r\n"García, Con Coma","línea uno\nlínea dos"\r\nSimple,"con ""comillas"""\r\n',
  );
  assert.deepEqual(encabezados, ['nombre', 'notas']);
  assert.equal(filas.length, 2);
  assert.equal(filas[0].valores.nombre, 'García, Con Coma');
  assert.equal(filas[0].valores.notas, 'línea uno\nlínea dos');
  assert.equal(filas[1].valores.notas, 'con "comillas"');
});

test('ignora el BOM aunque venga a media descarga, las notas con # y las filas vacías', () => {
  const { encabezados, filas } = analizarCSV(
    '# nota de la plantilla\r\n﻿id,nombre\r\n\r\n1,Uno\r\n#otra nota\r\n,\r\n2,Dos\r\n',
  );
  assert.deepEqual(encabezados, ['id', 'nombre']);
  assert.deepEqual(
    filas.map((f) => f.valores.nombre),
    ['Uno', 'Dos'],
  );
});

test('el número de línea de cada fila sirve para ubicar errores', () => {
  const { filas } = analizarCSV('a,b\nuno,1\n"dos\ncon salto",2\ntres,3\n');
  assert.deepEqual(
    filas.map((f) => f.linea),
    [2, 3, 5],
  );
});

test('lo serializado se puede volver a leer tal cual', () => {
  const csv = aCSV(['nombre', 'monto'], [['García, Con Coma', '1,500.00'], ['Con "comillas"', null]]);
  const { filas } = analizarCSV(csv);
  assert.equal(filas[0].valores.nombre, 'García, Con Coma');
  assert.equal(filas[0].valores.monto, '1,500.00');
  assert.equal(filas[1].valores.nombre, 'Con "comillas"');
  assert.equal(filas[1].valores.monto, '');
});
