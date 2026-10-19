import { type ReactNode, useCallback, useState } from 'react';

import { ReauthDialog } from '@/features/auth/reauth-dialog';
import { isApiError } from '@/lib/api-client';

/** La persona cerró el diálogo de reautenticación: la acción se abandona sin avisar de error. */
export class ReauthCancelledError extends Error {
  constructor() {
    super('reautenticación cancelada');
    this.name = 'ReauthCancelledError';
  }
}

type Pending = { resolve: () => void; reject: (error: Error) => void };

/**
 * Envuelve una acción sensible: si la API responde `reauth_required`, abre el diálogo del código del
 * móvil y, verificado, repite la acción. El componente debe pintar `dialog` en su árbol.
 */
export function useReauth(): {
  run: <T>(action: () => Promise<T>) => Promise<T>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (error) {
      if (!isApiError(error, 'reauth_required')) throw error;
      await new Promise<void>((resolve, reject) => {
        setPending({ resolve, reject });
      });
      return action();
    }
  }, []);

  const dialog = (
    <ReauthDialog
      open={pending !== null}
      onVerified={() => {
        pending?.resolve();
        setPending(null);
      }}
      onCancel={() => {
        pending?.reject(new ReauthCancelledError());
        setPending(null);
      }}
    />
  );

  return { run, dialog };
}
