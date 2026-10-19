import { crc32, deflateSync } from 'node:zlib';

/*
 * PNG mínimo generado a mano para los e2e que suben una foto (setInputFiles con buffer): firma +
 * IHDR + IDAT (zlib) + IEND. 2×2 píxeles RGB del amarillo LOS PAPIS. Sin archivos binarios en el repo.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData) >>> 0, 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** PNG RGB de `width`×`height` píxeles de un solo color (por defecto 2×2 amarillo). */
export function tinyPng(
  width = 2,
  height = 2,
  rgb: [number, number, number] = [0xfc, 0xd1, 0x16],
): Buffer {
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0); // filtro "None" al principio de cada fila
    for (let x = 0; x < width; x += 1) rows.push(...rgb);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profundidad de bits
  ihdr[9] = 2; // tipo de color: RGB
  ihdr[10] = 0; // compresión
  ihdr[11] = 0; // filtro
  ihdr[12] = 0; // sin entrelazado
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
