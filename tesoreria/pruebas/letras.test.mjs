/*
 * Monto en letra: un recibo con la cantidad mal escrita pierde toda seriedad,
 * así que esto se prueba caso por caso.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { montoEnLetras, enteroEnLetras } from '../src/lib/letras.ts';

test('cantidades típicas de la tesorería', () => {
  assert.equal(montoEnLetras(50000), 'QUINIENTOS PESOS 00/100 M.N.');
  assert.equal(montoEnLetras(500000), 'CINCO MIL PESOS 00/100 M.N.');
  assert.equal(montoEnLetras(600000), 'SEIS MIL PESOS 00/100 M.N.');
  assert.equal(montoEnLetras(150050), 'MIL QUINIENTOS PESOS 50/100 M.N.');
  assert.equal(montoEnLetras(350000), 'TRES MIL QUINIENTOS PESOS 00/100 M.N.');
});

test('casos con reglas propias del español', () => {
  assert.equal(montoEnLetras(100), 'UN PESO 00/100 M.N.');
  assert.equal(montoEnLetras(2100), 'VEINTIÚN PESOS 00/100 M.N.');
  assert.equal(montoEnLetras(3100), 'TREINTA Y UN PESOS 00/100 M.N.');
  assert.equal(montoEnLetras(10000), 'CIEN PESOS 00/100 M.N.');
  assert.equal(montoEnLetras(10100), 'CIENTO UN PESOS 00/100 M.N.');
  assert.equal(montoEnLetras(0), 'CERO PESOS 00/100 M.N.');
  assert.equal(montoEnLetras(75), 'CERO PESOS 75/100 M.N.');
});

test('miles y millones', () => {
  assert.equal(enteroEnLetras(1000), 'MIL');
  assert.equal(enteroEnLetras(21000), 'VEINTIÚN MIL');
  assert.equal(enteroEnLetras(100000), 'CIEN MIL');
  assert.equal(enteroEnLetras(716945), 'SETECIENTOS DIECISÉIS MIL NOVECIENTOS CUARENTA Y CINCO');
  assert.equal(montoEnLetras(100000000), 'UN MILLÓN DE PESOS 00/100 M.N.');
  assert.equal(montoEnLetras(250000000), 'DOS MILLONES QUINIENTOS MIL PESOS 00/100 M.N.');
});

test('rechaza lo que no es un entero de centavos', () => {
  assert.throws(() => montoEnLetras(10.5));
  assert.throws(() => montoEnLetras(-1));
});
