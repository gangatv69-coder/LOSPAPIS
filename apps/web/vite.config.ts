import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    // Requisito documentado por TanStack: el plugin del router va ANTES de @vitejs/plugin-react.
    tanstackRouter({
      target: 'react',
      // Opt-in: separa component/errorComponent/notFoundComponent de cada ruta en chunks.
      autoCodeSplitting: true,
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      // El archivo generado queda fuera de Biome, pero se genera ya con el estilo del proyecto.
      quoteStyle: 'single',
      semicolons: true,
    }),
    // Sin opciones: en v6 el React Refresh y el JSX los hace Oxc.
    react(),
  ],
  resolve: {
    alias: {
      // Mismo alias que components.json y tsconfig "paths". fileURLToPath soporta "C:\PROJECTS\Barber los papis".
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // /api/* -> apps/api en desarrollo (misma ruta que en Docker con Caddy): sin rewrite.
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Defaults de Vite 8 ya adecuados: minify 'oxc', target 'baseline-widely-available' (Safari 16.4+).
    outDir: 'dist',
    emptyOutDir: true,
  },
});
