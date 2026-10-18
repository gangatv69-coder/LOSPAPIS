import { isBuiltin } from 'node:module';

import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['./src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node26',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  minify: false,
  fixedExtension: true, // siempre dist/index.mjs
  deps: {
    // Un solo archivo para la imagen Docker: se empaqueta todo lo que no sea un módulo nativo de Node.
    alwaysBundle: (id) => !isBuiltin(id),
    onlyBundle: false, // silencia el aviso "unintended bundling": aquí es intencionado
  },
});
