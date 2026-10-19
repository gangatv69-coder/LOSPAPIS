import { isBuiltin } from 'node:module';

import { defineConfig } from 'tsdown';

// `pg` hace require('pg-native') dentro de un try/catch (cliente nativo opcional, no instalado): se deja como
// import externo que nunca se ejecuta en vez de intentar empaquetarlo. `external` está obsoleto en tsdown
// 0.23 y es incompatible con deps.neverBundle, y alwaysBundle se evalúa antes: por eso se excluye en los dos.
const NEVER_BUNDLE = ['pg-native'];

export default defineConfig({
  // Nombres fijos de salida: dist/index.mjs (la API), dist/migrate.mjs (servicio `migrate` de compose) y
  // dist/vapid-keys.mjs (genera las claves VAPID en el servidor). Lo que comparten va en trozos (chunk-*.mjs)
  // en el mismo dist: la imagen copia la carpeta entera.
  entry: {
    index: './src/index.ts',
    migrate: './src/migrate.ts',
    'vapid-keys': './src/cli/vapid-keys.ts',
  },
  format: 'esm',
  platform: 'node',
  target: 'node26',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  minify: false,
  fixedExtension: true, // siempre .mjs
  deps: {
    // Para la imagen Docker: se empaqueta todo lo que no sea un módulo nativo de Node.
    alwaysBundle: (id) => !isBuiltin(id) && !NEVER_BUNDLE.includes(id),
    neverBundle: NEVER_BUNDLE,
    onlyBundle: false, // silencia el aviso "unintended bundling": aquí es intencionado
  },
});
