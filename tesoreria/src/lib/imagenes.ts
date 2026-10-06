/*
 * Imagen para VER un comprobante en el navegador.
 *
 * El original nunca se toca: es el dato probatorio. Lo que cambia es lo que se
 * sirve para mirar: un HEIC (que muchos navegadores no pintan) se convierte a
 * JPEG una sola vez y el derivado queda en caché junto al original, con el
 * sufijo .visor.jpg. La conversión es heic-convert: JavaScript y WASM puros,
 * sin addons nativos que compilar en el VPS, que es la regla de la casa.
 */
import { createReadStream } from 'node:fs';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import convertirHeic from 'heic-convert';
import { config } from './config';
import type { FilaArchivo } from './archivos';

const raiz = resolve(config.COMPROBANTES_DIR);

/** Sufijo de los derivados de visor. El script de limpieza los ignora. */
export const SUFIJO_VISOR = '.visor.jpg';

function rutaSegura(rutaRelativa: string): string | null {
  const absoluta = resolve(raiz, rutaRelativa);
  return absoluta.startsWith(raiz + sep) ? absoluta : null;
}

/**
 * Respuesta con la imagen visible del archivo: el original si el navegador lo
 * pinta, o el JPEG derivado (con caché) si es HEIC. Devuelve null cuando el
 * archivo no es una imagen (un PDF se abre por su enlace normal).
 */
export async function respuestaImagenVisor(fila: FilaArchivo): Promise<Response | null> {
  if (!fila.mime.startsWith('image/')) return null;

  const original = rutaSegura(fila.ruta_relativa);
  if (!original) return null;

  let rutaServir = original;
  let mime = fila.mime;

  if (fila.mime === 'image/heic') {
    const derivada = original + SUFIJO_VISOR;
    try {
      await access(derivada);
    } catch {
      /* Primera vista: se convierte una vez y queda en caché, modo 600. */
      const heic = await readFile(original);
      const jpeg = await convertirHeic({ buffer: heic, format: 'JPEG', quality: 0.85 });
      const temporal = `${derivada}.tmp-${process.pid}`;
      await writeFile(temporal, Buffer.from(jpeg as ArrayBuffer), { mode: 0o600 });
      await rename(temporal, derivada);
    }
    rutaServir = derivada;
    mime = 'image/jpeg';
  }

  const flujo = Readable.toWeb(createReadStream(rutaServir)) as ReadableStream;
  return new Response(flujo, {
    headers: {
      'content-type': mime,
      'content-disposition': 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src 'self'; sandbox",
    },
  });
}
