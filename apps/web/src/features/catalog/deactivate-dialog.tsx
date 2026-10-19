import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type DeactivateDialogProps = {
  /** Nombre de lo que se desactiva; null = cerrado. */
  name: string | null;
  title: string;
  hint: string;
  confirmLabel: string;
  busy: boolean;
  testId: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** "¿Desactivar «X»?": nada se borra en el catálogo, se desactiva tras confirmar (como revocar un dispositivo). */
export function DeactivateDialog({
  name,
  title,
  hint,
  confirmLabel,
  busy,
  testId,
  onConfirm,
  onCancel,
}: DeactivateDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={name !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <DialogContent data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{hint}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-12 px-4"
            disabled={busy}
            onClick={onCancel}
          >
            {t('catalog.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="lg"
            className="h-12 px-4"
            disabled={busy}
            data-testid={`${testId}-confirm`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
