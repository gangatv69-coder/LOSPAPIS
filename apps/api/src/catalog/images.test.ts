import { describe, expect, it } from 'vitest';

import {
  gifHeader,
  JPEG_COMMENT,
  jpegHeader,
  pngHeader,
  svgText,
  webpVp8,
  webpVp8l,
  webpVp8x,
} from '../../test/setup/image-fixtures.ts';
import { sniffImage } from './images.ts';

describe('sniffImage', () => {
  it('JPEG: lee alto y ancho del primer SOF (baseline y progresivo)', () => {
    expect(sniffImage(jpegHeader(640, 480))).toEqual({
      mime: 'image/jpeg',
      width: 640,
      height: 480,
    });
    expect(sniffImage(jpegHeader(1024, 768, { sof: 0xc2 }))).toEqual({
      mime: 'image/jpeg',
      width: 1024,
      height: 768,
    });
    expect(sniffImage(jpegHeader(1600, 1600, { sof: 0xc1 }))).toMatchObject({
      width: 1600,
      height: 1600,
    });
  });

  it('JPEG: salta comentarios, marcadores sin longitud (RSTn, TEM) y relleno FF antes del SOF', () => {
    const before = [...JPEG_COMMENT, 0xff, 0xd0, 0xff, 0x01, 0xff, 0xff];
    expect(sniffImage(jpegHeader(300, 200, { before }))).toEqual({
      mime: 'image/jpeg',
      width: 300,
      height: 200,
    });
  });

  it('JPEG: sin SOF, truncado o con un SOF de medidas cero → null', () => {
    expect(sniffImage(jpegHeader(300, 200, { withoutFrame: true }))).toBeNull();
    expect(sniffImage(jpegHeader(300, 200).subarray(0, 24))).toBeNull();
    expect(sniffImage(jpegHeader(0, 200))).toBeNull();
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    // Un byte que no es FF donde debería empezar un marcador.
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0x00, 0xc0, 0x00, 0x11]))).toBeNull();
  });

  it('PNG: firma + IHDR, big-endian', () => {
    expect(sniffImage(pngHeader(2, 2))).toEqual({ mime: 'image/png', width: 2, height: 2 });
    expect(sniffImage(pngHeader(70_000, 3))).toEqual({
      mime: 'image/png',
      width: 70_000,
      height: 3,
    });
    expect(sniffImage(pngHeader(2, 2).subarray(0, 20))).toBeNull();
    expect(sniffImage(pngHeader(0, 2))).toBeNull();
    const notIhdr = pngHeader(2, 2);
    notIhdr.set([0x49, 0x44, 0x41, 0x54], 12); // IDAT donde tocaba IHDR
    expect(sniffImage(notIhdr)).toBeNull();
  });

  it('WebP: VP8 (con pérdida), VP8L (sin pérdida) y VP8X (extendido)', () => {
    expect(sniffImage(webpVp8(550, 368))).toEqual({ mime: 'image/webp', width: 550, height: 368 });
    expect(sniffImage(webpVp8l(1, 1))).toEqual({ mime: 'image/webp', width: 1, height: 1 });
    expect(sniffImage(webpVp8l(1024, 683))).toEqual({
      mime: 'image/webp',
      width: 1024,
      height: 683,
    });
    expect(sniffImage(webpVp8l(16_384, 16_384))).toMatchObject({ width: 16_384, height: 16_384 });
    expect(sniffImage(webpVp8x(1600, 900))).toEqual({
      mime: 'image/webp',
      width: 1600,
      height: 900,
    });
  });

  it('WebP: sin el inicio de frame de VP8, sin la firma de VP8L, chunk desconocido o truncado → null', () => {
    const badVp8 = webpVp8(10, 10);
    badVp8.set([0x00, 0x00, 0x00], 23);
    expect(sniffImage(badVp8)).toBeNull();
    const badVp8l = webpVp8l(10, 10);
    badVp8l[20] = 0x00;
    expect(sniffImage(badVp8l)).toBeNull();
    const unknownChunk = webpVp8x(10, 10);
    unknownChunk.set([0x41, 0x4c, 0x50, 0x48], 12); // ALPH
    expect(sniffImage(unknownChunk)).toBeNull();
    expect(sniffImage(webpVp8x(10, 10).subarray(0, 28))).toBeNull();
  });

  it('cualquier otra cosa → null: GIF, SVG, texto, vacío', () => {
    expect(sniffImage(gifHeader())).toBeNull();
    expect(sniffImage(svgText())).toBeNull();
    expect(sniffImage(new TextEncoder().encode('hola, esto no es una foto'))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
    expect(sniffImage(new Uint8Array(64))).toBeNull();
  });
});
