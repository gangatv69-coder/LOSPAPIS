import { createFileRoute, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { AuditViewer } from '@/features/audit/audit-viewer';
import { isManagerSession } from '@/features/auth/auth-guard';

export const Route = createFileRoute('/auditoria')({
  // Solo managers: un barbero (o un dispositivo sin usuario) vuelve al inicio.
  beforeLoad: ({ context }) => {
    if (!isManagerSession(context.auth)) throw redirect({ to: '/' });
  },
  component: AuditoriaPage,
});

/** Auditoría del manager (LP-10): descuentos, cortes gratis, anulaciones, fallos de PIN y cambios de precio. */
function AuditoriaPage() {
  const { t } = useTranslation();
  return (
    <section className="space-y-6">
      <h1 className="font-display text-4xl font-bold tracking-wide">{t('nav.audit')}</h1>
      <AuditViewer />
    </section>
  );
}
