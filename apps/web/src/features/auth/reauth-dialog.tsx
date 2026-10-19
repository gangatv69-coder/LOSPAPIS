import { useTranslation } from 'react-i18next';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TotpStep } from '@/features/auth/totp-step';
import { useAuth } from '@/features/auth/use-auth';

export type ReauthDialogProps = {
  open: boolean;
  onVerified: () => void;
  onCancel: () => void;
};

/**
 * "Confirma que eres tú": la API responde 403 reauth_required cuando la 2FA tiene más de 15 minutos
 * (poner el PIN, autorizar un dispositivo, desbloquear, crear managers). POST /api/auth/reauth con el
 * código del móvil y la acción se repite.
 */
export function ReauthDialog({ open, onVerified, onCancel }: ReauthDialogProps) {
  const { t } = useTranslation();
  const { reauth } = useAuth();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent data-testid="reauth-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold tracking-wide">
            {t('auth.reauth.title')}
          </DialogTitle>
          <DialogDescription>{t('auth.reauth.subtitle')}</DialogDescription>
        </DialogHeader>
        {open ? (
          <TotpStep
            allowBackupCode={false}
            verify={(body) => {
              // Sin el enlace de respaldo el paso solo envía { code }; el tipo compartido es una unión.
              if (!('code' in body)) return Promise.reject(new Error('reauth: falta el código'));
              return reauth.mutateAsync(body.code);
            }}
            onSuccess={onVerified}
            onCancel={onCancel}
            cancelLabel={t('auth.reauth.cancel')}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
