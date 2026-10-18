/**
 * Único punto de entrada de tipos para otros paquetes (apps/web).
 * Solo exporta tipos: con `import type` nada de la API acaba en el bundle del navegador.
 */
export type { App as AppType } from './app.ts';
