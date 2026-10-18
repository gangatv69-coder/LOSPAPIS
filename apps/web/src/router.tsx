import { createRouter } from '@tanstack/react-router';

import { queryClient } from '@/lib/query-client';

import { routeTree } from './routeTree.gen';

export const router = createRouter({
  routeTree,
  // Contexto disponible en loader/beforeLoad de todas las rutas: `context.queryClient`.
  context: { queryClient },
  // Precarga al pasar el ratón o tocar un Link (por defecto está desactivada).
  defaultPreload: 'intent',
  // Con TanStack Query como caché, el router no debe considerar "frescos" sus preloads.
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

// Registro del tipo del router: da tipado a Link, useNavigate, useParams, etc. en todo el proyecto.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
