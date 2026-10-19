import { describe, expect, it } from 'vitest';

import { targetSize } from '@/features/catalog/image-resize';

// El canvas no existe en jsdom: aquí solo la aritmética del tamaño destino; el resto se prueba en los e2e.
describe('targetSize', () => {
  it('reduce el lado mayor a maxSide manteniendo la proporción', () => {
    expect(targetSize(4032, 3024, 1024)).toEqual({ width: 1024, height: 768 });
    expect(targetSize(3024, 4032, 1024)).toEqual({ width: 768, height: 1024 });
    expect(targetSize(2000, 2000, 1024)).toEqual({ width: 1024, height: 1024 });
  });

  it('nunca amplía una imagen que ya cabe', () => {
    expect(targetSize(800, 600, 1024)).toEqual({ width: 800, height: 600 });
    expect(targetSize(2, 2, 1024)).toEqual({ width: 2, height: 2 });
    expect(targetSize(1024, 10, 1024)).toEqual({ width: 1024, height: 10 });
  });

  it('nunca devuelve un lado de 0 px', () => {
    expect(targetSize(5000, 1, 1024)).toEqual({ width: 1024, height: 1 });
    expect(targetSize(0, 0, 1024)).toEqual({ width: 1, height: 1 });
  });
});
