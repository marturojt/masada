/*
 * CSV sin dependencias. Lo suficiente para las plantillas de carga masiva:
 * comillas, comas y saltos de línea dentro de campos, BOM de Excel y CRLF.
 * Las líneas que empiezan con # son notas de la plantilla y se ignoran.
 */

export interface FilaCSV {
  /** Número de línea original, para que los errores se puedan ubicar. */
  linea: number;
  valores: Record<string, string>;
}

export function analizarCSV(texto: string): { encabezados: string[]; filas: FilaCSV[] } {
  /* Excel antepone un BOM al guardar UTF-8; se quita donde aparezca. */
  const limpio = texto.replace(/\uFEFF/g, '');

  const registros: { linea: number; celdas: string[] }[] = [];
  let celdas: string[] = [];
  let celda = '';
  let entreComillas = false;
  let linea = 1;
  let lineaInicio = 1;

  const cerrarCelda = () => {
    celdas.push(celda);
    celda = '';
  };
  const cerrarRegistro = () => {
    cerrarCelda();
    if (celdas.some((c) => c.trim() !== '')) {
      registros.push({ linea: lineaInicio, celdas });
    }
    celdas = [];
    lineaInicio = linea;
  };

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i]!;
    if (entreComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          celda += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        if (c === '\n') linea++;
        celda += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ',') {
      cerrarCelda();
    } else if (c === '\n') {
      linea++;
      cerrarRegistro();
    } else if (c !== '\r') {
      celda += c;
    }
  }
  cerrarRegistro();

  const utiles = registros.filter((r) => !r.celdas[0]!.trimStart().startsWith('#'));
  if (utiles.length === 0) return { encabezados: [], filas: [] };

  const encabezados = utiles[0]!.celdas.map((c) => c.trim().toLowerCase());
  const filas: FilaCSV[] = utiles.slice(1).map((r) => {
    const valores: Record<string, string> = {};
    encabezados.forEach((clave, i) => {
      valores[clave] = (r.celdas[i] ?? '').trim();
    });
    return { linea: r.linea, valores };
  });

  return { encabezados, filas };
}

const escapar = (v: string): string =>
  /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

/** Serializa con CRLF. El BOM lo antepone quien arma la descarga completa. */
export function aCSV(encabezados: string[], filas: (string | number | null)[][]): string {
  const lineas = [
    encabezados.join(','),
    ...filas.map((f) => f.map((v) => escapar(v == null ? '' : String(v))).join(',')),
  ];
  return `${lineas.join('\r\n')}\r\n`;
}
