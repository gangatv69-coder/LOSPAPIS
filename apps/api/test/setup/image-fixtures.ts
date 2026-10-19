/**
 * Cabeceras mínimas de imagen para las pruebas: a `sniffImage` (y a POST /api/photos) les basta la cabecera
 * para conocer el tipo y las medidas; ninguna de estas imágenes es decodificable.
 */

const hi = (value: number): number => (value >> 8) & 0xff;
const lo = (value: number): number => value & 0xff;
const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));
const le32 = (value: number): number[] => [
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
  (value >> 24) & 0xff,
];
const le24 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Firma + IHDR (33 bytes); `totalBytes` rellena con ceros para simular un archivo más grande. */
export const pngHeader = (width: number, height: number, totalBytes = 33): Uint8Array => {
  const bytes = new Uint8Array(Math.max(totalBytes, 33));
  bytes.set([...PNG_SIGNATURE, 0, 0, 0, 13, ...ascii('IHDR')]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  // 8 bits por canal, RGBA, sin entrelazado; el CRC se deja a cero.
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
};

export type JpegOptions = {
  /** Marcador del frame: C0 (baseline) por defecto; C2 = progresivo. */
  sof?: number;
  /** Bytes que se insertan entre APP0 y el SOF (otros segmentos, marcadores sueltos, relleno). */
  before?: number[];
  /** Sin SOF: solo SOI, APP0 y EOI. */
  withoutFrame?: boolean;
};

/** SOI + APP0 (JFIF) + [before] + SOF + EOI, sin datos de imagen. */
export const jpegHeader = (
  width: number,
  height: number,
  options: JpegOptions = {},
): Uint8Array => {
  const app0 = [
    0xff,
    0xe0,
    0x00,
    0x10,
    ...ascii('JFIF'),
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
  ];
  const frame = options.withoutFrame
    ? []
    : [
        0xff,
        options.sof ?? 0xc0,
        0x00,
        0x11,
        0x08,
        hi(height),
        lo(height),
        hi(width),
        lo(width),
        0x03,
        0x01,
        0x22,
        0x00,
        0x02,
        0x11,
        0x01,
        0x03,
        0x11,
        0x01,
      ];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...(options.before ?? []), ...frame, 0xff, 0xd9]);
};

/** Segmento COM ("hola") para intercalar antes del SOF. */
export const JPEG_COMMENT = [0xff, 0xfe, 0x00, 0x06, ...ascii('hola')];

const riff = (chunk: string, payload: number[]): Uint8Array =>
  Uint8Array.from([
    ...ascii('RIFF'),
    ...le32(4 + 8 + payload.length),
    ...ascii('WEBP'),
    ...ascii(chunk),
    ...le32(payload.length),
    ...payload,
  ]);

/** WebP con pérdida: frame tag (3), inicio de frame 9D 01 2A y medidas en 16 bits little-endian. */
export const webpVp8 = (width: number, height: number): Uint8Array =>
  riff('VP8 ', [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, lo(width), hi(width), lo(height), hi(height)]);

/** WebP sin pérdida: firma 2F y 14 + 14 bits (medida menos uno) empaquetados. */
export const webpVp8l = (width: number, height: number): Uint8Array => {
  const w = width - 1;
  const h = height - 1;
  return riff('VP8L', [
    0x2f,
    w & 0xff,
    ((w >> 8) & 0x3f) | ((h & 0x03) << 6),
    (h >> 2) & 0xff,
    (h >> 10) & 0x0f,
  ]);
};

/** WebP extendido: flags (1), reservados (3) y medidas menos uno en 24 bits little-endian. */
export const webpVp8x = (width: number, height: number): Uint8Array =>
  riff('VP8X', [0x00, 0x00, 0x00, 0x00, ...le24(width - 1), ...le24(height - 1)]);

export const gifHeader = (): Uint8Array =>
  Uint8Array.from([...ascii('GIF89a'), 0x02, 0x00, 0x02, 0x00, 0x80, 0x00, 0x00]);

export const svgText = (): Uint8Array =>
  Uint8Array.from(ascii('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'));
