import { TIMEZONE } from '@los-papis/shared';
import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { HEALTH_REFRESH_MS, healthQueryOptions } from '@/features/health/health.queries';
import { fallbackLanguage } from '@/i18n';

/** Descompone un total de segundos en los valores de `health.uptimeValue`. */
function splitSeconds(total: number) {
  const whole = Math.max(0, Math.floor(total));
  return {
    hours: Math.floor(whole / 3600),
    minutes: Math.floor((whole % 3600) / 60),
    seconds: whole % 60,
  };
}

function StatusDot({ tone }: { tone: 'online' | 'offline' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-2.5 shrink-0 rounded-full',
        tone === 'online' ? 'bg-brand-blue dark:bg-brand-yellow' : 'bg-destructive',
      )}
    />
  );
}

/**
 * Tarjeta de estado: lo que responde GET /api/health (estado, versión, hora de Roma y tiempo
 * en marcha), refrescado cada 10 s. Si una consulta falla se conservan los últimos datos
 * y se avisa; el botón vuelve a intentarlo sin esperar al siguiente ciclo.
 */
export function HealthCard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? fallbackLanguage;
  const health = useQuery({
    ...healthQueryOptions,
    // Se vuelve a pedir cada 10 s mientras la pestaña está visible.
    refetchInterval: HEALTH_REFRESH_MS,
  });

  const romeTime = health.data
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'medium',
        timeZone: TIMEZONE,
      }).format(new Date(health.data.time))
    : null;
  const updatedAt =
    health.dataUpdatedAt > 0
      ? new Intl.DateTimeFormat(locale, { timeStyle: 'medium' }).format(health.dataUpdatedAt)
      : null;

  return (
    <Card data-testid="health-card" className="max-w-xl">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-semibold tracking-wide">
          {t('health.title')}
        </CardTitle>
        <CardDescription>
          {t('status.subtitle', { seconds: HEALTH_REFRESH_MS / 1000 })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {health.isPending ? (
          <p role="status" className="text-muted-foreground">
            {t('health.checking')}
          </p>
        ) : null}
        {health.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <StatusDot tone="offline" />
              {t('health.unreachable')}
            </p>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 px-4"
              disabled={health.isFetching}
              onClick={() => {
                void health.refetch();
              }}
            >
              <RefreshCw className={cn('size-4', health.isFetching && 'animate-spin')} />
              {t('health.retry')}
            </Button>
          </div>
        ) : null}
        {health.data ? (
          <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-3">
            <dt className="text-muted-foreground">{t('health.status')}</dt>
            <dd className="flex items-center gap-2 font-medium">
              <StatusDot tone={health.isError ? 'offline' : 'online'} />
              {health.isError ? t('health.unreachable') : t('health.online')}
            </dd>
            <dt className="text-muted-foreground">{t('health.version')}</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">
              {health.data.version}
            </dd>
            <dt className="text-muted-foreground">{t('health.time')}</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">
              <time dateTime={health.data.time}>{romeTime}</time>
            </dd>
            <dt className="text-muted-foreground">{t('health.uptime')}</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">
              {t('health.uptimeValue', splitSeconds(health.data.uptimeSeconds))}
            </dd>
          </dl>
        ) : null}
      </CardContent>
      {updatedAt ? (
        <CardFooter className="text-sm text-muted-foreground tabular-nums">
          {t('health.updatedAt', { time: updatedAt })}
        </CardFooter>
      ) : null}
    </Card>
  );
}
