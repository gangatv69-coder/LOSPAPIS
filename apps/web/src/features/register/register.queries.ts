import { queryOptions } from '@tanstack/react-query';

import { fetchDaySales } from '@/features/register/register.api';

/** Prefijo de todo lo relativo a los cobros: invalidar ['sales'] refresca la lista del día tras cada cobro. */
export const SALES_QUERY_PREFIX = ['sales'] as const;

/** GET /api/sales/day: los cobros de un día de caja (sin `day`, el de hoy) y sus totales. */
export const daySalesQueryOptions = (day?: string) =>
  queryOptions({
    queryKey: [...SALES_QUERY_PREFIX, 'day', day ?? 'today'] as const,
    queryFn: () => fetchDaySales(day),
  });
