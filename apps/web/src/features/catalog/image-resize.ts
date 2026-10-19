import { PHOTO_MAX_BYTES, PHOTO_TARGET_SIDE } from '@los-papis/shared';

/*
 * Reducción de fotos en el propio dispositivo (iPad o PC) antes de subirlas: lado mayor 1024 px y JPEG.
 * Una foto de 12 MP del iPad pesa 3-5 MB; así llega a la API en unas decenas de KB y la API solo valida
 * (tipo por bytes, ≤ 400 KB, ≤ 1600 px) y guarda.
 */

export type ResizeOptions = {
  /** Lado mayor del resultado (por defecto PHOTO_TARGET_SIDE). Nunca se amplía. */
  maxSide?: number;
  /** Calidad JPEG del primer intento. */
  quality?: number;
};

/** El navegador no ha podido decodificar el archivo (no es una imagen o es un formato que no entiende). */
export class ImageDecodeError extends Error {
  constructor() {
    super('No se ha podido decodificar la imagen');
    this.name = 'ImageDecodeError';
  }
}

export type Size = { width: number; height: number };

/** Tamaño destino manteniendo la proporción: el lado mayor pasa a `maxSide`; si ya cabe, se queda igual. */
export function targetSize(width: number, height: number, maxSide: number): Size {
  const longest = Math.max(width, height);
  if (longest <= 0) return { width: 1, height: 1 };
  if (longest <= maxSide) return { width: Math.round(width), height: Math.round(height) };
  if (width >= height) {
    return { width: maxSide, height: Math.max(1, Math.round((height * maxSide) / width)) };
  }
  return { width: Math.max(1, Math.round((width * maxSide) / height)), height: maxSide };
}

type Decoded = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

/** Decodifica con createImageBitmap (respeta la orientación EXIF) o, si no existe, con un <img>. */
async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Algún formato o navegador que no decodifica por esta vía: se prueba con <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new ImageDecodeError());
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** Pinta la imagen reducida en un canvas y la codifica como JPEG (fondo blanco: el JPEG no tiene alfa). */
function paint(decoded: Decoded, maxSide: number, quality: number): Promise<Blob> {
  const { width, height } = targetSize(decoded.width, decoded.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new ImageDecodeError());
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(decoded.source, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImageDecodeError())),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Reduce `file` a un JPEG de lado mayor `maxSide`. Si sigue pesando más de lo que acepta la API, se
 * repite con calidad 0.7 y después con la mitad del lado; se devuelve el primero que cabe (o el último).
 */
export async function resizeImage(
  file: Blob,
  { maxSide = PHOTO_TARGET_SIDE, quality = 0.82 }: ResizeOptions = {},
): Promise<Blob> {
  const decoded = await decode(file);
  try {
    const attempts: ReadonlyArray<{ side: number; quality: number }> = [
      { side: maxSide, quality },
      { side: maxSide, quality: 0.7 },
      { side: Math.max(1, Math.round(maxSide / 2)), quality: 0.7 },
    ];
    let result: Blob | null = null;
    for (const attempt of attempts) {
      result = await paint(decoded, attempt.side, attempt.quality);
      if (result.size <= PHOTO_MAX_BYTES) break;
    }
    if (!result) throw new ImageDecodeError();
    return result;
  } finally {
    decoded.release();
  }
}
