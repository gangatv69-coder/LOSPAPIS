/*
 * Genera los iconos provisionales "LOS PAPIS" de la PWA a partir de la marca (no hay logo todavía).
 * Renderiza HTML con el Chromium de Playwright y guarda PNG en public/. Se ejecuta UNA vez y los PNG
 * se commitean; cuando haya logo se cambia la plantilla y se vuelve a ejecutar:
 *
 *   pnpm --filter @los-papis/web run icons
 *
 * La fuente (Barlow Condensed 700, la misma de la cabecera) se carga desde node_modules con una URL
 * file:// absoluta. Chromium solo deja cargar file:// desde una página file://, y las fuentes además
 * pasan por CORS: por eso se navega a la carpeta de la fuente y se lanza con --allow-file-access-from-files.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium, type Page } from '@playwright/test';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const publicDir = path.join(webRoot, 'public');
const fontFile = path.join(
  webRoot,
  'node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2',
);
const fontUrl = pathToFileURL(fontFile).href;

// Paleta de la marca (apps/web/src/styles/globals.css).
const BACKGROUND = '#111216';
const YELLOW = '#fcd116';
const BLUE = '#003893';
const RED = '#ce1126';
const WHITE = '#ffffff';

const baseStyles = `
  @font-face {
    font-family: 'Barlow Condensed';
    font-style: normal;
    font-weight: 700;
    src: url('${fontUrl}') format('woff2');
  }
  html, body { margin: 0; padding: 0; background: transparent; }
  #icon {
    position: relative;
    overflow: hidden;
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    line-height: 0.82;
  }
  .text { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .los { color: ${YELLOW}; }
  .papis { color: ${WHITE}; }
  .stripe { position: absolute; display: grid; grid-template-columns: 2fr 1fr 1fr; }
  .stripe i { display: block; }
`;

function htmlDocument(size: number, styles: string, body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
${baseStyles}
#icon { width: ${size}px; height: ${size}px; }
${styles}
</style></head><body><div id="icon">${body}</div></body></html>`;
}

const brandText =
  '<div class="text"><span class="los">LOS</span><span class="papis">PAPIS</span></div>';
const stripe = `<div class="stripe"><i style="background:${YELLOW}"></i><i style="background:${BLUE}"></i><i style="background:${RED}"></i></div>`;

/** Icono "any" y apple-touch-icon: fondo oscuro a sangre, marca en dos líneas y franja tricolor abajo. */
function brandIcon(size: number): string {
  return htmlDocument(
    size,
    `
    #icon { background: ${BACKGROUND}; }
    .text { inset: 0 0 7% 0; font-size: ${Math.round(size * 0.3)}px; }
    .stripe { left: 0; right: 0; bottom: 0; height: 7%; }
    `,
    brandText + stripe,
  );
}

/**
 * Icono "maskable" (Android): mismo diseño con todo el contenido dentro del 80 % central, que es
 * la zona segura que ningún recorte (círculo, squircle...) se come. La franja va más estrecha.
 */
function maskableIcon(size: number): string {
  return htmlDocument(
    size,
    `
    #icon { background: ${BACKGROUND}; }
    .text { inset: 12% 12% 22% 12%; font-size: ${Math.round(size * 0.25)}px; }
    .stripe { left: 22%; right: 22%; bottom: 13%; height: 4.5%; border-radius: 2px; overflow: hidden; }
    `,
    brandText + stripe,
  );
}

/** Insignia de Android: glifo "LP" blanco sobre transparente (Android solo usa la silueta). */
function badgeIcon(size: number): string {
  return htmlDocument(
    size,
    `
    .text { inset: 0; font-size: ${Math.round(size * 0.78)}px; letter-spacing: 0; color: ${WHITE}; }
    `,
    '<div class="text"><span>LP</span></div>',
  );
}

const icons = [
  { file: 'icons/icon-192.png', size: 192, html: brandIcon(192) },
  { file: 'icons/icon-512.png', size: 512, html: brandIcon(512) },
  { file: 'icons/icon-512-maskable.png', size: 512, html: maskableIcon(512) },
  // iOS no admite transparencia aquí y redondea las esquinas él mismo: cuadrado opaco.
  { file: 'apple-touch-icon.png', size: 180, html: brandIcon(180) },
  { file: 'icons/badge-96.png', size: 96, html: badgeIcon(96) },
] as const;

/** Falla en vez de generar iconos con la fuente de reserva si Barlow Condensed no se ha cargado. */
async function ensureFontLoaded(page: Page): Promise<void> {
  const loaded = await page.evaluate(async () => {
    const faces = await document.fonts.load('700 100px "Barlow Condensed"');
    return faces.filter((face) => face.status === 'loaded').length;
  });
  if (loaded === 0) {
    throw new Error(`No se ha cargado Barlow Condensed 700 desde ${fontUrl}`);
  }
}

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
try {
  const page = await browser.newPage({
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: 1,
  });
  // Página de origen file:// (el listado de la carpeta de la fuente) para que la fuente file:// cargue.
  await page.goto(`${pathToFileURL(path.dirname(fontFile)).href}/`);

  for (const icon of icons) {
    await page.setContent(icon.html);
    await ensureFontLoaded(page);
    const png = await page.locator('#icon').screenshot({ type: 'png', omitBackground: true });
    const target = path.join(publicDir, icon.file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, png);
    console.log(
      `${path.relative(webRoot, target)}  ${icon.size}x${icon.size}  ${png.byteLength} bytes`,
    );
  }
} finally {
  await browser.close();
}
