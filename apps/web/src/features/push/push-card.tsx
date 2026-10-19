import { type PushSubscriptionStatus, TIMEZONE } from '@los-papis/shared';
import { useQuery } from '@tanstack/react-query';
import { BellOff, BellRing, RefreshCw, Send } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  fetchPushConfig,
  fetchPushStatus,
  requestTestPush,
  subscribeOnServer,
  subscriptionToJson,
  unsubscribeOnServer,
} from '@/features/push/push.api';
import {
  classifyPush,
  describeDevice,
  type PushAvailability,
  readPushEnvironment,
  urlBase64ToUint8Array,
} from '@/features/push/push-support';
import { fallbackLanguage, isSupportedLanguage } from '@/i18n';
import { ApiError } from '@/lib/api-client';

/** Retardos del aviso de prueba, en segundos: el tiempo para cerrar la app antes de que llegue. */
const TEST_DELAYS = [0, 10, 30] as const;
const DEFAULT_DELAY = 10;

const buttonSize = 'h-12 px-4';

/** Suscripción del navegador: undefined = aún no se ha preguntado; null = no hay. */
type BrowserSubscription = PushSubscription | null | undefined;

/**
 * Tarjeta "Avisos en este dispositivo" (prueba S4 de la arquitectura): activar Web Push con la clave
 * VAPID del servidor, enviar un aviso de prueba con retardo, consultar si llegó y desactivar.
 * Notification.requestPermission() y pushManager.subscribe() se llaman DENTRO del onClick: iOS
 * solo los acepta como respuesta a un gesto del usuario.
 */
export function PushCard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? fallbackLanguage;
  const language = isSupportedLanguage(locale) ? locale : fallbackLanguage;

  const [availability, setAvailability] = useState<PushAvailability>(() =>
    classifyPush(readPushEnvironment()),
  );
  const [device] = useState(() => describeDevice());
  const [subscription, setSubscription] = useState<BrowserSubscription>(
    availability === 'available' ? undefined : null,
  );
  const [status, setStatus] = useState<PushSubscriptionStatus | null>(null);
  const [delay, setDelay] = useState<number>(DEFAULT_DELAY);
  const [scheduled, setScheduled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);

  const config = useQuery({ queryKey: ['push', 'config'], queryFn: fetchPushConfig });
  const serverEnabled = config.data?.enabled === true;

  // Al montar: ¿este navegador ya tiene suscripción? Si la tiene se vuelve a registrar en la API
  // (que guarda las suscripciones en memoria y las pierde al reiniciar) con el idioma actual.
  useEffect(() => {
    if (availability !== 'available') return;
    let cancelled = false;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then(async (current) => {
        if (cancelled) return;
        setSubscription(current);
        if (!current) return;
        try {
          const result = await subscribeOnServer(subscriptionToJson(current), device, language);
          if (!cancelled) {
            setStatus(result);
            setSyncFailed(false);
          }
        } catch {
          if (!cancelled) setSyncFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setSubscription(null);
      });
    return () => {
      cancelled = true;
    };
  }, [availability, device, language]);

  async function enable() {
    const publicKey = config.data?.publicKey;
    if (!publicKey) return;
    setBusy(true);
    try {
      // Primera llamada del gesto: el permiso (iOS exige que salga de un toque del usuario).
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        if (permission === 'denied') setAvailability('denied');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const created = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const result = await subscribeOnServer(subscriptionToJson(created), device, language);
      setSubscription(created);
      setStatus(result);
      setSyncFailed(false);
      setScheduled(false);
      toast.success(t('push.enabled'));
    } catch {
      toast.error(t('push.error'));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!subscription) return;
    setBusy(true);
    try {
      const endpoint = subscription.endpoint;
      try {
        await requestTestPush(endpoint, delay);
      } catch (error) {
        // 404 = la API se reinició y olvidó la suscripción: se registra de nuevo y se reintenta.
        if (!(error instanceof ApiError && error.status === 404)) throw error;
        setStatus(await subscribeOnServer(subscriptionToJson(subscription), device, language));
        await requestTestPush(endpoint, delay);
      }
      setScheduled(true);
      toast.info(t('push.testScheduled', { seconds: delay }));
    } catch {
      toast.error(t('push.error'));
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus() {
    if (!subscription) return;
    setBusy(true);
    try {
      setStatus(await fetchPushStatus(subscription.endpoint));
      setSyncFailed(false);
    } catch {
      toast.error(t('push.error'));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!subscription) return;
    setBusy(true);
    try {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      setSubscription(null);
      setStatus(null);
      setScheduled(false);
      setSyncFailed(false);
      await unsubscribeOnServer(endpoint);
      toast.success(t('push.disabled'));
    } catch {
      toast.error(t('push.error'));
    } finally {
      setBusy(false);
    }
  }

  const lastDelivery = status?.lastDelivery;
  const lastDeliveryText = lastDelivery
    ? t('push.lastDelivery', {
        time: new Intl.DateTimeFormat(locale, { timeStyle: 'medium', timeZone: TIMEZONE }).format(
          new Date(lastDelivery.at),
        ),
        result: lastDelivery.ok
          ? t('push.resultOk')
          : t('push.resultFailed', { code: lastDelivery.statusCode ?? lastDelivery.error ?? '—' }),
      })
    : null;

  let body: ReactNode;
  if (availability === 'needsInstall') {
    body = (
      <div className="space-y-2">
        <p>{t('push.iosInstallTitle')}</p>
        <ol className="list-decimal space-y-1 pl-6">
          <li>{t('push.iosStep1')}</li>
          <li>{t('push.iosStep2')}</li>
          <li>{t('push.iosStep3')}</li>
        </ol>
      </div>
    );
  } else if (availability === 'unsupported') {
    body = <p>{t('push.unsupported')}</p>;
  } else if (availability === 'denied') {
    body = (
      <p role="alert" className="font-medium text-destructive">
        {t('push.denied')}
      </p>
    );
  } else if (subscription === undefined) {
    body = (
      <p role="status" className="text-muted-foreground">
        {t('push.checking')}
      </p>
    );
  } else if (subscription === null) {
    body = (
      <div className="space-y-3">
        <Button
          type="button"
          size="lg"
          className={buttonSize}
          disabled={busy || !serverEnabled}
          onClick={() => {
            void enable();
          }}
        >
          <BellRing className="size-4" />
          {t('push.enable')}
        </Button>
        {config.isPending ? (
          <p role="status" className="text-muted-foreground">
            {t('push.checking')}
          </p>
        ) : null}
        {config.isError ? (
          <p role="alert" className="text-destructive">
            {t('push.error')}
          </p>
        ) : null}
        {config.data && !config.data.enabled ? (
          <p className="text-muted-foreground">{t('push.serverDisabled')}</p>
        ) : null}
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        <p className="flex items-center gap-2 font-medium">
          <BellRing className="size-4 shrink-0 text-brand-blue dark:text-brand-yellow" />
          {t('push.activeOn', { device: status?.device ?? device })}
        </p>
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="mb-2 text-muted-foreground">{t('push.delayLabel')}</legend>
          {TEST_DELAYS.map((seconds) => (
            <Button
              key={seconds}
              type="button"
              size="lg"
              className={buttonSize}
              variant={delay === seconds ? 'secondary' : 'outline'}
              aria-pressed={delay === seconds}
              onClick={() => setDelay(seconds)}
            >
              {t('push.delay', { seconds })}
            </Button>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            size="lg"
            className={buttonSize}
            disabled={busy}
            onClick={() => {
              void sendTest();
            }}
          >
            <Send className="size-4" />
            {t('push.sendTest')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className={buttonSize}
            disabled={busy}
            onClick={() => {
              void checkStatus();
            }}
          >
            <RefreshCw className="size-4" />
            {t('push.checkStatus')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className={buttonSize}
            disabled={busy}
            onClick={() => {
              void disable();
            }}
          >
            <BellOff className="size-4" />
            {t('push.disable')}
          </Button>
        </div>
        {scheduled ? (
          <p role="status" className="font-medium">
            {t('push.closeAppHint')}
          </p>
        ) : null}
        {status ? (
          <p className="text-muted-foreground tabular-nums">
            {lastDeliveryText ?? t('push.noDelivery')}
          </p>
        ) : null}
        {syncFailed ? (
          <p role="alert" className="text-destructive">
            {t('push.error')}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Card data-testid="push-card" className="max-w-xl">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-semibold tracking-wide">
          {t('push.title')}
        </CardTitle>
        <CardDescription>{t('push.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{body}</CardContent>
    </Card>
  );
}
