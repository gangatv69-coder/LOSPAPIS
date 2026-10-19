import type { PhotoMime } from '@los-papis/shared';

/**
 * Tipo y medidas de una imagen leyendo solo su cabecera (bytes mágicos), sin decodificarla ni depender de
 * librerías nativas: la API no se fía del content-type ni de la extensión. Entiende JPEG (primer SOF), PNG
 * (IHDR) y WebP (VP8, VP8L y VP8X). Cualquier otra cosa (GIF, SVG, texto, un archivo truncado) → null.
 */

export type ImageInfo = { mime: PhotoMime; width: number; height: number };

const u16be = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);

/** Multiplica en vez de desplazar 24 bits: así nunca sale negativo. */
const u32be = (bytes: Uint8Array, offset: number): number =>
  u16be(bytes, offset) * 0x10000 + u16be(bytes, offset + 2);

const u16le = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);

const u24le = (bytes: Uint8Array, offset: number): number =>
  u16le(bytes, offset) | ((bytes[offset + 2] ?? 0) << 16);

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

const startsWith = (bytes: Uint8Array, offset: number, expected: readonly number[]): boolean =>
  expected.every((value, i) => bytes[offset + i] === value);

const dimensions = (mime: PhotoMime, width: number, height: number): ImageInfo | null =>
  width > 0 && height > 0 ? { mime, width, height } : null;

// --- JPEG ------------------------------------------------------------------------------------

const JPEG_SOI = 0xd8;
const JPEG_EOI = 0xd9;
/** Start of scan: a partir de aquí van los datos comprimidos; si no hubo SOF antes, la imagen no vale. */
const JPEG_SOS = 0xda;
/** Start of frame: C0–C3, C5–C7, C9–CB y CD–CF (C4, C8 y CC son DHT, JPG y DAC). */
const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/** Marcadores sin longitud: SOI, TEM (01) y RSTn (D0–D7). */
const isStandaloneMarker = (marker: number): boolean =>
  marker === JPEG_SOI || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

/** Recorre los segmentos (FF xx + longitud big-endian) hasta el primer SOF: alto en +5 y ancho en +7. */
const sniffJpeg = (bytes: Uint8Array): ImageInfo | null => {
  if (bytes[0] !== 0xff || bytes[1] !== JPEG_SOI) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      // Relleno entre segmentos.
      offset += 1;
      continue;
    }
    if (isStandaloneMarker(marker)) {
      offset += 2;
      continue;
    }
    if (marker === JPEG_EOI || marker === JPEG_SOS) return null;
    const length = u16be(bytes, offset + 2);
    if (length < 2) return null;
    if (JPEG_SOF.has(marker)) {
      if (offset + 9 > bytes.length) return null;
      return dimensions('image/jpeg', u16be(bytes, offset + 7), u16be(bytes, offset + 5));
    }
    offset += 2 + length;
  }
  return null;
};

// --- PNG -------------------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Firma de 8 bytes + IHDR (siempre el primer chunk): ancho en 16 y alto en 20, big-endian. */
const sniffPng = (bytes: Uint8Array): ImageInfo | null => {
  if (bytes.length < 24 || !startsWith(bytes, 0, PNG_SIGNATURE)) return null;
  if (ascii(bytes, 12, 4) !== 'IHDR') return null;
  return dimensions('image/png', u32be(bytes, 16), u32be(bytes, 20));
};

// --- WebP ------------------------------------------------------------------------------------

/** Bytes de inicio de frame de VP8 (con pérdida). */
const VP8_FRAME_START = [0x9d, 0x01, 0x2a] as const;
/** Byte de firma de VP8L (sin pérdida). */
const VP8L_SIGNATURE = 0x2f;

/** "RIFF....WEBP" y el primer chunk en 12: VP8 (con pérdida), VP8L (sin pérdida) o VP8X (extendido). */
const sniffWebp = (bytes: Uint8Array): ImageInfo | null => {
  if (bytes.length < 16 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    return null;
  }
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8 ') {
    if (bytes.length < 30 || !startsWith(bytes, 23, VP8_FRAME_START)) return null;
    return dimensions('image/webp', u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff);
  }
  if (chunk === 'VP8L') {
    if (bytes.length < 25 || bytes[20] !== VP8L_SIGNATURE) return null;
    const b0 = bytes[21] ?? 0;
    const b1 = bytes[22] ?? 0;
    const b2 = bytes[23] ?? 0;
    const b3 = bytes[24] ?? 0;
    // 14 bits de ancho y 14 de alto, ambos menos uno, empaquetados tras la firma.
    const width = (b0 | ((b1 & 0x3f) << 8)) + 1;
    const height = ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)) + 1;
    return dimensions('image/webp', width, height);
  }
  if (chunk === 'VP8X') {
    if (bytes.length < 30) return null;
    // Tras flags (1) y reservados (3): ancho y alto menos uno en 24 bits little-endian.
    return dimensions('image/webp', u24le(bytes, 24) + 1, u24le(bytes, 27) + 1);
  }
  return null;
};

/** Tipo (uno de PHOTO_MIMES) y medidas de la imagen, o null si los bytes no son un JPEG, PNG o WebP legible. */
export const sniffImage = (bytes: Uint8Array): ImageInfo | null =>
  sniffJpeg(bytes) ?? sniffPng(bytes) ?? sniffWebp(bytes);
