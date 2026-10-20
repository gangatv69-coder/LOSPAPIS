import { formatCents, type PaymentMethod, type Sale } from '@los-papis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { PinDialogProps } from '@/components/pin-dialog';
import { recordTip } from '@/features/register/register.api';
import { SALES_QUERY_PREFIX } from '@/features/register/register.queries';
import { registerErrorMessage } from '@/features/register/register-errors';
import { isApiError } from '@/lib/api-client';

/** Lo que se elige en el formulario de la propina. */
export type TipChoice = { amountCents: number; method: PaymentMethod };

/** La firma del PIN que se acaba de usar (la del cobro) y cuándo se consiguió (Date.now()). */
export type PinSignature = { assertion: string; signedAt: number };

/** La aserción del PIN vale 120 s en la API; aquí se reutiliza hasta los 100 s para no rozar el límite. */
export const SIGNATURE_FRESH_MS = 100_000;

export const isFreshSignature = (
  signature: PinSignature | null | undefined,
  now: number,
): signature is PinSignature =>
  signature !== null && signature !== undefined && now - signature.signedAt < SIGNATURE_FRESH_MS;

type Pending = { sale: Sale; tip: TipChoice };
type Variables = Pending & { assertion: string };

/**
 * Apuntar la propina de un cobro (LP-23): con la firma del cobro si es reciente (justo después de cobrar no se
 * vuelve a pedir el PIN) y, si no hay o la API la rechaza por caducada, con el PIN de un manager. Devuelve
 * `record` y las props del diálogo del PIN que el componente pinta.
 */
export function useTipRecorder(onSaved: (sale: Sale) => void) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [pinOpen, setPinOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: ({ sale, tip, assertion }: Variables) =>
      recordTip(sale.id, { ...tip, pinAssertion: assertion }),
    onSuccess: async (saved) => {
      setPending(null);
      toast.success(
        t('register.tip.saved', {
          amount: formatCents(saved.tip?.amountCents ?? 0),
          barber: saved.barberName,
        }),
      );
      onSaved(saved);
      await queryClient.invalidateQueries({ queryKey: SALES_QUERY_PREFIX });
    },
    onError: (caught, { sale, tip }) => {
      if (isApiError(caught, 'pin_assertion_invalid')) {
        // La firma caducó (o era de otro sitio): la misma propina, ahora con el PIN.
        setPending({ sale, tip });
        setPinOpen(true);
        return;
      }
      setPending(null);
      toast.error(registerErrorMessage(caught, t));
      // Ya tenía propina, se anuló o es de otro día: la lista se pone al día.
      void queryClient.invalidateQueries({ queryKey: SALES_QUERY_PREFIX });
    },
  });

  function record(sale: Sale, tip: TipChoice, signature?: PinSignature | null) {
    if (isFreshSignature(signature, Date.now())) {
      mutation.mutate({ sale, tip, assertion: signature.assertion });
      return;
    }
    setPending({ sale, tip });
    setPinOpen(true);
  }

  const pinDialog: PinDialogProps = {
    open: pinOpen,
    onOpenChange: setPinOpen,
    description: pending
      ? t('register.tip.pinFor', {
          amount: formatCents(pending.tip.amountCents),
          barber: pending.sale.barberName,
        })
      : undefined,
    onVerified: (result) => {
      if (pending) mutation.mutate({ ...pending, assertion: result.assertion });
    },
  };

  return { record, busy: mutation.isPending, pinDialog };
}
