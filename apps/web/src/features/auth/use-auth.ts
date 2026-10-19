import type { AuthState, DeviceSummary, SessionUser } from '@los-papis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { logout as logoutRequest, reauth as reauthRequest } from '@/features/auth/auth.api';
import { AUTH_QUERY_PREFIX, authStateQueryOptions } from '@/features/auth/auth.queries';

/** Usuario con la sesión completa (con la 2FA pendiente todavía no cuenta como dentro). */
export function sessionUserOf(state: AuthState | undefined): SessionUser | null {
  if (!state || state.pendingTotp) return null;
  return state.user;
}

/**
 * Estado de acceso en los componentes. El guardia de __root.tsx ya lo ha cargado con ensureQueryData,
 * así que `state` está disponible desde el primer render; las pantallas de acceso lo actualizan con
 * `setAuthState` a partir de lo que devuelve la API, sin volver a pedir /me.
 */
export function useAuth() {
  const queryClient = useQueryClient();
  const query = useQuery(authStateQueryOptions);
  const state = query.data;
  const user = sessionUserOf(state);
  const device: DeviceSummary | null = state?.device ?? null;

  const setAuthState = useCallback(
    (next: AuthState) => {
      queryClient.setQueryData(authStateQueryOptions.queryKey, next);
    },
    [queryClient],
  );

  const refreshAuth = useCallback(
    () => queryClient.invalidateQueries({ queryKey: AUTH_QUERY_PREFIX }),
    [queryClient],
  );

  const logout = useMutation({
    mutationFn: logoutRequest,
    // Falle o no la petición, aquí ya no hay nadie: el guardia vuelve a decidir con el estado nuevo.
    onSettled: async () => {
      queryClient.setQueryData(authStateQueryOptions.queryKey, (previous) =>
        previous ? { ...previous, user: null, pendingTotp: false } : previous,
      );
      await queryClient.invalidateQueries({ queryKey: AUTH_QUERY_PREFIX });
    },
  });

  const reauth = useMutation({
    mutationFn: reauthRequest,
    onSuccess: setAuthState,
  });

  return {
    state,
    user,
    device,
    isManager: user?.role === 'manager',
    isPending: query.isPending,
    setAuthState,
    refreshAuth,
    logout,
    reauth,
  };
}
