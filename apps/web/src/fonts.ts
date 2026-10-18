/*
 * Fuentes autoalojadas con Fontsource. Importar UNA vez desde main.tsx, antes de globals.css.
 * Cada CSS trae @font-face con unicode-range por subconjunto: el navegador solo descarga los
 * .woff2 que la página necesita.
 */

// Barlow Condensed (estática): familia CSS 'Barlow Condensed'. Pesos 500, 600 y 700 del tema.
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';

// Geist (variable, eje wght 100-900): familia CSS 'Geist Variable'.
import '@fontsource-variable/geist';
