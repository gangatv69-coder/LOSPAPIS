/*
 * Service worker de LOS PAPIS: SOLO avisos push (prueba S4).
 * No hay manejador `fetch`: la versión 1 no tiene modo sin conexión (arquitectura §4.4), así que
 * todas las peticiones siguen yendo directas a la red y el navegador no guarda copia de nada.
 * Es JS plano servido desde public/ (sin build): Caddy lo entrega con Cache-Control no-cache para
 * que el navegador vea siempre la versión nueva.
 */

self.addEventListener('install', () => {
  // La versión nueva sustituye a la anterior sin esperar a que se cierren las pestañas.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Toma el control de las pestañas abiertas desde ya (sin recargar).
  event.waitUntil(self.clients.claim());
});

/**
 * Carga útil del aviso: { title, body, url?, tag? } (pushPayloadSchema en packages/shared).
 * Si no llega JSON válido se muestra un aviso genérico en vez de perderlo.
 */
function readPayload(event) {
  const fallback = { title: 'LOS PAPIS', body: '' };
  if (!event.data) return fallback;
  try {
    const data = event.data.json();
    if (data && typeof data.title === 'string' && data.title !== '') {
      return { ...fallback, ...data };
    }
  } catch {
    // Texto plano o JSON roto: se enseña tal cual como cuerpo.
    return { ...fallback, body: event.data.text() };
  }
  return fallback;
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: typeof payload.body === 'string' ? payload.body : '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: typeof payload.tag === 'string' ? payload.tag : undefined,
      data: { url: typeof payload.url === 'string' ? payload.url : '/' },
    }),
  );
});

/** Lleva al usuario a la ruta del aviso: enfoca una ventana de la app si la hay, si no abre una. */
async function openOrFocus(url) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = windows.find((w) => w.url.startsWith(self.location.origin)) ?? windows[0];
  if (!client) {
    await self.clients.openWindow(url);
    return;
  }
  await client.focus();
  try {
    // navigate() solo funciona en ventanas controladas por este worker; en el resto se queda donde estaba.
    if ('navigate' in client) await client.navigate(url);
  } catch {
    // Sin navegación: la ventana ya está en primer plano, que es lo importante.
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data ?? {};
  const url = new URL(typeof data.url === 'string' ? data.url : '/', self.location.origin).href;
  event.waitUntil(openOrFocus(url));
});
