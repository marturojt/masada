/*
 * La casilla de confirmación de las acciones sin vuelta atrás: el navegador la
 * pide con required, pero quien la exige es el esquema del servidor.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { z } from 'zod';
import { confirmacion } from '../src/lib/esquemas/comunes.ts';

const esquema = z.object({ motivo: z.string(), confirmo: confirmacion('Marca la casilla.') });

test('sin la casilla, el envío se rechaza con un mensaje en español', () => {
  const r = esquema.safeParse({ motivo: 'Capturado dos veces' });
  assert.equal(r.success, false);
  assert.equal(r.error.issues[0].path[0], 'confirmo');
  assert.equal(r.error.issues[0].message, 'Marca la casilla.');
});

test('con la casilla marcada, pasa', () => {
  const r = esquema.safeParse({ motivo: 'Capturado dos veces', confirmo: 'si' });
  assert.equal(r.success, true);
});

test('un valor distinto de "si" no cuenta como confirmación', () => {
  assert.equal(esquema.safeParse({ motivo: 'x', confirmo: 'on' }).success, false);
  assert.equal(esquema.safeParse({ motivo: 'x', confirmo: '' }).success, false);
});
