/*
 * Estado general en CSV, para trabajarlo en Excel. Un solo archivo: la columna
 * Sección permite filtrar caja, adeudos, Gran Tesorería y demás.
 */
import type { APIRoute } from 'astro';
import { aCSV } from '@lib/csv';
import { estadoGeneral, filasCSV } from '@lib/datos/estado-general';
import { anioDeUrl, ejercicioVigente, listarEjercicios } from '@lib/datos/ejercicios';
import { hoyISO } from '@lib/fechas';
import { requerirSesion } from '@lib/sesion';

export const GET: APIRoute = async (contexto) => {
  requerirSesion(contexto);

  const ejercicios = await listarEjercicios();
  const vigente = await ejercicioVigente();
  const anio = anioDeUrl(contexto.url, ejercicios, vigente.anio);
  const { encabezados, filas } = filasCSV(await estadoGeneral(anio));

  /* El BOM va al inicio para que Excel lo abra en UTF-8. */
  return new Response(`﻿${aCSV(encabezados, filas)}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="estado-general-${hoyISO()}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
};
