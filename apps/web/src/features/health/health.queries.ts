import { queryOptions } from '@tanstack/react-query';

import { fetchHealth } from '@/lib/api-client';

/** Cada cuánto se vuelve a consultar el estado del servidor en pantalla. */
export const HEALTH_REFRESH_MS = 10_000;

// queryOptions() conserva la inferencia de tipos al compartir la consulta entre
// useQuery, el loader del router (queryClient.query) y setQueryData.
export const healthQueryOptions = queryOptions({
  queryKey: ['health'],
  queryFn: fetchHealth,
  staleTime: HEALTH_REFRESH_MS,
});
