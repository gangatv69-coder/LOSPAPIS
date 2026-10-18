import { QueryClient } from '@tanstack/react-query';

/**
 * Un único QueryClient para toda la app: lo usan QueryClientProvider (hooks)
 * y el contexto del router (loaders). Se crea fuera del árbol de React.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Por defecto todo es obsoleto al instante (staleTime 0). 30 s es un término medio.
      staleTime: 30_000,
      // Default de la librería (5 min); explícito para que quede documentado.
      gcTime: 5 * 60_000,
      // Un solo reintento (default 3 con backoff): en la caja interesa enseñar el error pronto.
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});
