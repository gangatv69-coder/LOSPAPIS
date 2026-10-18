import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/ajustes')({
  component: AjustesPage,
});

function AjustesPage() {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <h1 className="font-display text-4xl font-bold tracking-wide">{t('nav.settings')}</h1>
      <p className="text-muted-foreground">{t('placeholder.comingSoon')}</p>
    </section>
  );
}
