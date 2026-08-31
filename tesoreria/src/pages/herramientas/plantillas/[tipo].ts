/*
 * Plantillas CSV para la carga masiva. La de hermanos trae el padrón actual
 * (con id, para actualizar); las de ingresos y egresos traen las columnas y
 * las claves válidas como notas (#), que el importador ignora.
 */
import type { APIRoute } from 'astro';
import { aCSV } from '@lib/csv';
import { listarConceptos } from '@lib/datos/conceptos';
import { anioActual } from '@lib/fechas';
import { listarHermanos } from '@lib/datos/hermanos';
import { consulta } from '@lib/db';
import { requerirSesion } from '@lib/sesion';

/* El BOM va al inicio del archivo completo, para que Excel lo abra en UTF-8. */
const respuestaCSV = (nombre: string, contenido: string): Response =>
  new Response(`\uFEFF${contenido}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Cache-Control': 'private, no-store',
    },
  });

export const GET: APIRoute = async (contexto) => {
  requerirSesion(contexto);

  const tipo = contexto.params.tipo ?? '';

  if (tipo === 'hermanos') {
    const hermanos = await listarHermanos({ estatus: 'todos', anio: anioActual() });
    /* Las fechas de aumento y exaltación viven en el historial de grados. */
    const eventos = await consulta<{ hermano_id: number; tipo_evento: string; fecha: string }>(
      `select hermano_id, tipo_evento, fecha::text from hermano_grado
        where tipo_evento in ('aumento_salario', 'exaltacion')`,
    );
    const fechaDe = (hermanoId: number, tipoEvento: string): string | null =>
      eventos.find((e) => e.hermano_id === hermanoId && e.tipo_evento === tipoEvento)?.fecha ?? null;

    const cuerpo = aCSV(
      [
        'id', 'nombre_completo', 'grado', 'fecha_ingreso', 'motivo_ingreso',
        'fecha_iniciacion', 'fecha_aumento_salario', 'fecha_exaltacion',
        'fecha_afiliacion', 'correo', 'telefono', 'notas',
      ],
      hermanos.map((h) => [
        h.id, h.nombre_completo, h.grado, h.fecha_ingreso, h.motivo_ingreso,
        h.fecha_iniciacion, fechaDe(h.id, 'aumento_salario'), fechaDe(h.id, 'exaltacion'),
        h.fecha_afiliacion, h.correo, h.telefono, h.notas,
      ]),
    );
    const notas = [
      '# Padrón actual. Fila con id = actualiza (celda vacía conserva lo que hay);',
      '# fila sin id = alta. Grados: aprendiz | companero | maestro. Fechas AAAA-MM-DD.',
      '# Motivos: iniciacion | afiliacion | regularizacion (miembro de años anteriores,',
      '# cuando no se sabe si nació en Masada o llegó de otra logia). Si el motivo es',
      '# regularizacion y la fecha de ingreso va vacía, queda el 31 de diciembre del',
      '# año anterior. En iniciados y afiliados, las fechas de secretaría que vayan',
      '# vacías se toman de la fecha de ingreso.',
      '# Las fechas de iniciación, aumento de salario y exaltación completan el',
      '# historial de grados solo si el hermano no tiene ya un evento de ese tipo;',
      '# corregir una fecha ya capturada se hace en la ficha del hermano.',
      '',
    ].join('\r\n');
    return respuestaCSV('hermanos.csv', notas + cuerpo);
  }

  if (tipo === 'ingresos') {
    const conceptos = await listarConceptos({ naturaleza: 'ingreso' });
    const claves = conceptos
      .filter((c) => c.seleccionable || c.tipo_especial === 'capita')
      .map((c) => `${c.clave} (${c.nombre})`)
      .join(' | ');
    const notas = [
      '# Un ingreso por fila. Montos en pesos (500 o 500.00), fechas AAAA-MM-DD.',
      `# Claves de concepto: ${claves}.`,
      '# Bolsa: banco | efectivo. Hermano: nombre completo exacto o su id; puede ir vacío.',
      '# Los pagos con clave capita exigen hermano con modalidad asignada y se aplican',
      '# del mes más antiguo con saldo hacia adelante, igual que en el módulo.',
      '',
    ].join('\r\n');
    return respuestaCSV(
      'ingresos.csv',
      notas + aCSV(['fecha', 'concepto', 'bolsa', 'monto', 'hermano', 'descripcion'], []),
    );
  }

  if (tipo === 'egresos') {
    const conceptos = await listarConceptos({ naturaleza: 'egreso' });
    const claves = conceptos
      .filter((c) => c.tipo_especial !== 'gran_tesoreria')
      .map((c) => `${c.clave} (${c.nombre})`)
      .join(' | ');
    const notas = [
      '# Un egreso por fila. Nacen en estado REGISTRADO: las dos firmas y la entrega',
      '# con comprobante se hacen después en la pantalla de cada egreso.',
      `# Claves de concepto: ${claves}.`,
      '# por_comprobar: si | no. Los pagos a la Gran Tesorería no van aquí: se',
      '# capturan como obligaciones en su módulo.',
      '',
    ].join('\r\n');
    return respuestaCSV(
      'egresos.csv',
      notas +
        aCSV(
          ['fecha', 'concepto', 'beneficiario', 'monto', 'descripcion', 'por_comprobar', 'hermano', 'notas'],
          [],
        ),
    );
  }

  return new Response('No encontrado', { status: 404 });
};
