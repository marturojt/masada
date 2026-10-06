/* Tipos mínimos de heic-convert, que no publica los suyos. */
declare module 'heic-convert' {
  interface OpcionesConversion {
    buffer: Buffer | Uint8Array;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }
  function convertir(opciones: OpcionesConversion): Promise<Buffer | ArrayBuffer>;
  export default convertir;
}
