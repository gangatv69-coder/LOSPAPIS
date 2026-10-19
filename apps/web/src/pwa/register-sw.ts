/**
 * Registra /sw.js (solo avisos push; ver public/sw.js). Se llama desde main.tsx antes de montar
 * React, pero el registro en sí espera al evento `load` para no competir con la carga de la app.
 * Si el navegador no tiene service workers, o el registro falla (por ejemplo en http sin ser
 * localhost), la app sigue funcionando: solo se pierden los avisos.
 */
export function registerServiceWorker(nav: Navigator = navigator, win: Window = window): void {
  if (!('serviceWorker' in nav)) return;

  const register = () => {
    nav.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
      // Queda en la consola del móvil para poder depurarlo; la app no se entera.
      console.warn('No se ha podido registrar el service worker de los avisos', error);
    });
  };

  if (win.document.readyState === 'complete') {
    register();
  } else {
    win.addEventListener('load', register, { once: true });
  }
}
