import { type QueryClient, queryOptions } from '@tanstack/react-query';

import {
  fetchBarberCandidates,
  fetchBarbers,
  fetchCatalog,
  fetchProducts,
  fetchServices,
} from '@/features/catalog/catalog.api';

/** Lo que pinta la caja: activos en orden. Lo comparten /caja y, más adelante, el cobro (LP-09). */
export const catalogQueryOptions = queryOptions({
  queryKey: ['catalog'],
  queryFn: fetchCatalog,
});

/** Listas de administración (todos, inactivos incluidos). */
export const servicesQueryOptions = queryOptions({
  queryKey: ['services'],
  queryFn: fetchServices,
});

export const productsQueryOptions = queryOptions({
  queryKey: ['products'],
  queryFn: fetchProducts,
});

export const barbersQueryOptions = queryOptions({
  queryKey: ['barbers'],
  queryFn: fetchBarbers,
});

/**
 * Usuarios con cuenta y sin perfil de barbero: se vuelve a pedir cada vez que se abre "Nuevo barbero".
 * Cuelga de ['barbers']: crear un perfil invalida también esta lista.
 */
export const barberCandidatesQueryOptions = queryOptions({
  queryKey: ['barbers', 'candidates'],
  queryFn: fetchBarberCandidates,
  staleTime: 0,
});

/** Tras cada cambio: la lista de administración afectada y lo que lee la caja. */
export async function invalidateCatalog(
  queryClient: QueryClient,
  listKey: readonly string[],
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: listKey }),
    queryClient.invalidateQueries({ queryKey: catalogQueryOptions.queryKey }),
  ]);
}
