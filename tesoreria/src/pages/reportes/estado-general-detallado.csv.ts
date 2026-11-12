/*
 * Estado general detallado en CSV: las filas del estado general y el libro de
 * ingresos y egresos, con fecha, folio, bolsa, comprobante y quién capturó.
 */
import type { APIRoute } from 'astro';
import { aCSV } from '@lib/csv';
import { estadoDetallado, filasCSVDetallado } from '@lib/datos/estado-detallado';
import { anioDeUrl, ejercicioVigente, listarEjercicios } from '@lib/datos/ejercicios';
import { hoyISO } from '@lib/fechas';
import { requerirSesion } from '@lib/sesion';

export const GET: APIRoute = async (contexto) => {
  requerirSesion(contexto);

  const ejercicios = await listarEjercicios();
  const vigente = await ejercicioVigente();
  const anio = anioDeUrl(contexto.url, ejercicios, vigente.anio);
  const { encabezados, filas } = filasCSVDetallado(await estadoDetallado(anio));

  /* El BOM va al inicio para que Excel lo abra en UTF-8. */
  return new Response(`﻿${aCSV(encabezados, filas)}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="estado-general-detallado-${anio}-${hoyISO()}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
};
