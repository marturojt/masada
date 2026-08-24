/*
 * Comprobantes: recepción, validación y almacenamiento en disco.
 *
 * Decisiones que importan:
 *
 * - El tipo se determina por los primeros bytes del archivo, nunca por la
 *   extensión ni por el content-type que manda el navegador. La extensión en
 *   disco se deriva del tipo detectado.
 * - SVG queda fuera a propósito: es XML ejecutable y servirlo en línea es XSS.
 * - No se transcodifica ni se comprime. Un comprobante financiero alterado
 *   pierde valor probatorio, y meter una librería de imágenes en la ruta de
 *   petición significaría procesar contenido subido por el usuario en código
 *   nativo, justo lo que no se quiere en este servidor.
 * - Escritura atómica: se escribe un .tmp en el mismo directorio y se renombra.
 *   El archivo se escribe antes de confirmar la transacción; si la transacción
 *   falla queda un huérfano en disco, que es preferible a una fila que apunta a
 *   la nada. scripts/limpiar-huerfanos.mjs los recoge.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { config } from './config';
import { consulta, unaFila, type Tx } from './db';
import { ErrorDeNegocio } from './errores';

export type MimePermitido =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/heic'
  | 'application/pdf';

const EXTENSION: Record<MimePermitido, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

/** Los tipos que un navegador pinta sin descargar. El PDF se manda como adjunto. */
const VISIBLES_EN_LINEA = new Set<MimePermitido>(['image/jpeg', 'image/png', 'image/webp']);

const MARCAS_HEIC = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis']);

/** Detecta el tipo por los primeros bytes. Devuelve null si no está en la lista. */
export function detectarTipo(datos: Uint8Array): MimePermitido | null {
  const en = (i: number): number => datos[i] ?? -1;
  const texto = (desde: number, hasta: number): string =>
    Buffer.from(datos.subarray(desde, hasta)).toString('latin1');

  if (en(0) === 0xff && en(1) === 0xd8 && en(2) === 0xff) return 'image/jpeg';

  if (
    en(0) === 0x89 &&
    texto(1, 4) === 'PNG' &&
    en(4) === 0x0d &&
    en(5) === 0x0a &&
    en(6) === 0x1a &&
    en(7) === 0x0a
  ) {
    return 'image/png';
  }

  if (texto(0, 5) === '%PDF-') return 'application/pdf';

  if (texto(0, 4) === 'RIFF' && texto(8, 12) === 'WEBP') return 'image/webp';

  if (texto(4, 8) === 'ftyp' && MARCAS_HEIC.has(texto(8, 12).toLowerCase())) {
    return 'image/heic';
  }

  return null;
}

export const NOMBRES_TIPO: Record<MimePermitido, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'image/heic': 'HEIC de iPhone',
  'application/pdf': 'PDF',
};

/** Raíz del almacén, resuelta una sola vez. */
const raizComprobantes = resolve(config.COMPROBANTES_DIR);

export interface ArchivoGuardado {
  id: number;
  rutaRelativa: string;
  mime: MimePermitido;
  bytes: number;
}

/**
 * Valida y guarda un archivo subido. Devuelve la fila de archivo, reutilizándola
 * si ese mismo contenido ya se había subido antes.
 *
 * Ojo: escribe en disco y en la tabla archivo fuera de la transacción del caso de
 * uso, a propósito, para que un archivo a medio subir no deje la transacción
 * abierta mientras se copian megabytes.
 */
export async function guardarComprobante(
  entrada: File,
  usuarioId: number,
  fechaISO: string,
): Promise<ArchivoGuardado> {
  if (entrada.size === 0) {
    throw new ErrorDeNegocio('El archivo llegó vacío. Vuelve a elegirlo.');
  }
  if (entrada.size > config.TS_MAX_SUBIDA_BYTES) {
    const mb = Math.floor(config.TS_MAX_SUBIDA_BYTES / (1024 * 1024));
    throw new ErrorDeNegocio(
      `El archivo pesa más de ${mb} MB. Si es una foto, súbela más pequeña.`,
    );
  }

  const datos = new Uint8Array(await entrada.arrayBuffer());
  const mime = detectarTipo(datos);

  if (mime === null) {
    throw new ErrorDeNegocio(
      'Ese archivo no es una imagen ni un PDF. Se aceptan JPEG, PNG, WEBP, HEIC y PDF.',
    );
  }

  const sha256 = createHash('sha256').update(datos).digest('hex');

  /* Mismo contenido ya subido: se reutiliza la fila y no se escribe otra vez. */
  const previo = await unaFila<{ id: number; ruta_relativa: string; bytes: number }>(
    'select id, ruta_relativa, bytes from archivo where sha256 = $1',
    [sha256],
  );
  if (previo) {
    return {
      id: previo.id,
      rutaRelativa: previo.ruta_relativa,
      mime,
      bytes: previo.bytes,
    };
  }

  const anio = fechaISO.slice(0, 4);
  const mes = fechaISO.slice(5, 7);
  const carpeta = `${anio}/${mes}`;
  const nombre = `${randomUUID()}.${EXTENSION[mime]}`;
  const rutaRelativa = `${carpeta}/${nombre}`;

  const carpetaAbsoluta = join(raizComprobantes, anio, mes);
  await mkdir(carpetaAbsoluta, { recursive: true, mode: 0o700 });

  const destino = join(carpetaAbsoluta, nombre);
  const temporal = `${destino}.tmp`;
  await writeFile(temporal, datos, { mode: 0o600 });
  await rename(temporal, destino);

  try {
    const fila = await unaFila<{ id: number }>(
      `insert into archivo (ruta_relativa, nombre_original, mime, bytes, sha256, subido_por)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [
        rutaRelativa,
        nombreSeguro(entrada.name),
        mime,
        datos.byteLength,
        sha256,
        usuarioId,
      ],
    );
    return { id: fila!.id, rutaRelativa, mime, bytes: datos.byteLength };
  } catch (error) {
    /* Si no se pudo registrar, no se deja basura en disco. */
    await unlink(destino).catch(() => {});
    throw error;
  }
}

/** Nombre original saneado. Solo se guarda para mostrarlo y para la descarga. */
function nombreSeguro(nombre: string): string {
  const limpio = nombre
    /* Fuera caracteres de control y separadores de ruta. */
    .replace(new RegExp('[\\u0000-\\u001f\\u007f]', 'g'), '')
    .replace(/[/\\]/g, '_')
    .trim();
  return (limpio.length === 0 ? 'comprobante' : limpio).slice(0, 150);
}

export interface FilaArchivo {
  id: number;
  ruta_relativa: string;
  nombre_original: string;
  mime: MimePermitido;
  bytes: number;
}

export const obtenerArchivo = (id: number): Promise<FilaArchivo | null> =>
  unaFila<FilaArchivo>(
    'select id, ruta_relativa, nombre_original, mime, bytes from archivo where id = $1',
    [id],
  );

/**
 * Respuesta para servir un comprobante. Solo se llama después de comprobar la
 * sesión: estos archivos no son públicos.
 */
export function respuestaArchivo(fila: FilaArchivo): Response {
  /*
   * Blindaje contra traversal aunque la ruta de la base estuviera contaminada:
   * el archivo tiene que quedar dentro de la raíz del almacén.
   */
  const absoluta = resolve(raizComprobantes, fila.ruta_relativa);
  if (!absoluta.startsWith(raizComprobantes + sep)) {
    return new Response('No encontrado', { status: 404 });
  }

  const enLinea = VISIBLES_EN_LINEA.has(fila.mime);
  const nombreCodificado = encodeURIComponent(fila.nombre_original);

  const flujo = Readable.toWeb(createReadStream(absoluta)) as ReadableStream;

  return new Response(flujo, {
    headers: {
      /* Tipo detectado al subir, jamás el que declaró el cliente. */
      'content-type': fila.mime,
      'content-length': String(fila.bytes),
      'content-disposition': `${enLinea ? 'inline' : 'attachment'}; filename*=UTF-8''${nombreCodificado}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      /* El comprobante no debe poder ejecutar nada ni pedir nada. */
      'content-security-policy': "default-src 'none'; img-src 'self'; sandbox",
    },
  });
}

/** Archivos que ya no tiene referenciado nadie, para el script de limpieza. */
export const archivosHuerfanos = (): Promise<FilaArchivo[]> =>
  consulta<FilaArchivo>(
    `select a.id, a.ruta_relativa, a.nombre_original, a.mime, a.bytes
       from archivo a
      where not exists (select 1 from movimiento m where m.archivo_id = a.id)
      order by a.subido_en`,
  );

/** Borra la fila y el archivo. Solo lo usa el script de limpieza. */
export async function borrarArchivo(tx: Tx, fila: FilaArchivo): Promise<void> {
  await tx.consulta('delete from archivo where id = $1', [fila.id]);
  const absoluta = resolve(raizComprobantes, fila.ruta_relativa);
  if (absoluta.startsWith(raizComprobantes + sep)) {
    await unlink(absoluta).catch(() => {});
  }
}
