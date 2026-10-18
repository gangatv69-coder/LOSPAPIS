import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { healthQueryOptions } from '@/features/health/health.queries';
import { HealthCard } from '@/features/health/health-card';

export const Route = createFileRoute('/')({
  loader: ({ context: { queryClient } }) => {
    // Precalienta la caché sin bloquear la navegación: query() rechaza con el error, de ahí el catch.
    void queryClient.query(healthQueryOptions).catch(() => undefined);
  },
  component: StatusPage,
});

function StatusPage() {
  const { t } = useTranslation();
  return (
    <section className="space-y-6">
      <h1 className="font-display text-5xl font-bold tracking-wide">{t('status.title')}</h1>
      <HealthCard />
    </section>
  );
}
