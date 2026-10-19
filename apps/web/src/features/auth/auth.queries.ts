import { queryOptions } from '@tanstack/react-query';

import { fetchAuthState, fetchDevices, fetchManagers, fetchUsers } from '@/features/auth/auth.api';

/** Prefijo de todo lo relativo al acceso: invalidar ['auth'] refresca la sesión y los managers. */
export const AUTH_QUERY_PREFIX = ['auth'] as const;

/**
 * GET /api/auth/me compartido entre el guardia del router (ensureQueryData en beforeLoad), la cabecera
 * y las pantallas (useQuery). 30 s de frescura: navegar entre pestañas no vuelve a preguntar.
 */
export const authStateQueryOptions = queryOptions({
  queryKey: ['auth', 'me'],
  queryFn: fetchAuthState,
  staleTime: 30_000,
});

/** Managers con PIN para el diálogo "¿Quién cobra?": se vuelve a pedir cada vez que se abre. */
export const managersQueryOptions = queryOptions({
  queryKey: ['auth', 'managers'],
  queryFn: fetchManagers,
  staleTime: 0,
});

export const devicesQueryOptions = queryOptions({
  queryKey: ['devices'],
  queryFn: fetchDevices,
});

export const usersQueryOptions = queryOptions({
  queryKey: ['users'],
  queryFn: fetchUsers,
});
