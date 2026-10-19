import { createFileRoute, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { isManagerSession } from '@/features/auth/auth-guard';
import { BarbersAdmin } from '@/features/catalog/barbers-admin';

export const Route = createFileRoute('/equipo')({
  // Solo managers: un barbero (o un dispositivo sin usuario) vuelve al inicio.
  beforeLoad: ({ context }) => {
    if (!isManagerSession(context.auth)) throw redirect({ to: '/' });
  },
  component: EquipoPage,
});

/** Equipo del manager: los perfiles de barbero que ven la caja y la agenda. */
function EquipoPage() {
  const { t } = useTranslation();
  return (
    <section className="space-y-6">
      <h1 className="font-display text-4xl font-bold tracking-wide">{t('nav.team')}</h1>
      <BarbersAdmin />
    </section>
  );
}
