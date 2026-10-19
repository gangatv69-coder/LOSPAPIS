import { describe, expect, it } from 'vitest';

import {
  classifyPush,
  describeDevice,
  type PushEnvironment,
  type PushNavigator,
  type PushWindow,
  readPushEnvironment,
  urlBase64ToUint8Array,
} from '@/features/push/push-support';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  // iPad con "sitio de escritorio" (por defecto en iPadOS): se presenta como un Mac.
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

function fakeWindow(opts: {
  push?: boolean;
  permission?: NotificationPermission | null;
  standalone?: boolean;
}): PushWindow {
  return {
    matchMedia: (query) => ({
      matches: query === '(display-mode: standalone)' && opts.standalone === true,
    }),
    PushManager: opts.push === false ? undefined : class {},
    Notification:
      opts.permission === null ? undefined : { permission: opts.permission ?? 'default' },
  };
}

function fakeNavigator(opts: {
  userAgent: string;
  touch?: number;
  serviceWorker?: boolean;
  standalone?: boolean;
}): PushNavigator {
  return {
    userAgent: opts.userAgent,
    maxTouchPoints: opts.touch ?? 0,
    serviceWorker: opts.serviceWorker === false ? undefined : {},
    standalone: opts.standalone,
  };
}

const fullSupport: PushEnvironment = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: 'default',
  isIos: false,
  isStandalone: false,
};

describe('readPushEnvironment', () => {
  it('lee soporte completo en Chrome de Windows', () => {
    const env = readPushEnvironment(
      fakeWindow({ permission: 'granted' }),
      fakeNavigator({ userAgent: UA.windowsChrome }),
    );
    expect(env).toEqual<PushEnvironment>({
      hasServiceWorker: true,
      hasPushManager: true,
      hasNotification: true,
      permission: 'granted',
      isIos: false,
      isStandalone: false,
    });
  });

  it('en Safari de iPhone sin instalar no hay PushManager ni Notification', () => {
    const env = readPushEnvironment(
      fakeWindow({ push: false, permission: null }),
      fakeNavigator({ userAgent: UA.iphoneSafari, touch: 5 }),
    );
    expect(env.isIos).toBe(true);
    expect(env.isStandalone).toBe(false);
    expect(env.hasPushManager).toBe(false);
    expect(env.hasNotification).toBe(false);
    expect(env.permission).toBe('unsupported');
  });

  it('reconoce el iPad que se presenta como Mac por la pantalla táctil', () => {
    const ipad = readPushEnvironment(
      fakeWindow({}),
      fakeNavigator({ userAgent: UA.ipadDesktop, touch: 5 }),
    );
    const mac = readPushEnvironment(fakeWindow({}), fakeNavigator({ userAgent: UA.macSafari }));
    expect(ipad.isIos).toBe(true);
    expect(mac.isIos).toBe(false);
  });

  it('detecta la app instalada por display-mode o por navigator.standalone', () => {
    const byMedia = readPushEnvironment(
      fakeWindow({ standalone: true }),
      fakeNavigator({ userAgent: UA.androidChrome }),
    );
    const bySafari = readPushEnvironment(
      fakeWindow({}),
      fakeNavigator({ userAgent: UA.iphoneSafari, standalone: true }),
    );
    expect(byMedia.isStandalone).toBe(true);
    expect(bySafari.isStandalone).toBe(true);
  });

  it('funciona aunque window no tenga matchMedia', () => {
    const env = readPushEnvironment({}, { userAgent: UA.windowsChrome });
    expect(env.isStandalone).toBe(false);
    expect(env.hasPushManager).toBe(false);
  });
});

describe('classifyPush', () => {
  it('available con soporte completo y permiso sin decidir o concedido', () => {
    expect(classifyPush(fullSupport)).toBe('available');
    expect(classifyPush({ ...fullSupport, permission: 'granted' })).toBe('available');
  });

  it('needsInstall en iOS fuera de la app instalada, aunque el navegador exponga las APIs', () => {
    expect(classifyPush({ ...fullSupport, isIos: true })).toBe('needsInstall');
    expect(
      classifyPush({
        ...fullSupport,
        isIos: true,
        hasPushManager: false,
        hasNotification: false,
        permission: 'unsupported',
      }),
    ).toBe('needsInstall');
  });

  it('available en iOS con la app instalada y las APIs presentes', () => {
    expect(classifyPush({ ...fullSupport, isIos: true, isStandalone: true })).toBe('available');
  });

  it('unsupported si falta alguna API (fuera de iOS, o en iOS instalada pero antigua)', () => {
    expect(classifyPush({ ...fullSupport, hasServiceWorker: false })).toBe('unsupported');
    expect(classifyPush({ ...fullSupport, hasPushManager: false })).toBe('unsupported');
    expect(
      classifyPush({ ...fullSupport, hasNotification: false, permission: 'unsupported' }),
    ).toBe('unsupported');
    expect(
      classifyPush({ ...fullSupport, isIos: true, isStandalone: true, hasPushManager: false }),
    ).toBe('unsupported');
  });

  it('denied cuando el usuario bloqueó los avisos', () => {
    expect(classifyPush({ ...fullSupport, permission: 'denied' })).toBe('denied');
  });
});

describe('urlBase64ToUint8Array', () => {
  // Clave pública VAPID de ejemplo (87 caracteres base64url = 65 bytes sin relleno).
  const VAPID_KEY =
    'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

  it('convierte una clave VAPID de 87 caracteres en 65 bytes que empiezan por 0x04', () => {
    expect(VAPID_KEY).toHaveLength(87);
    const bytes = urlBase64ToUint8Array(VAPID_KEY);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });

  it('deshace el alfabeto url-safe (- y _) y el relleno que falta', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x3e, 0x00]);
    const standard = btoa(String.fromCharCode(...bytes));
    expect(standard).toContain('+');
    expect(standard).toContain('/');
    const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(Array.from(urlBase64ToUint8Array(urlSafe))).toEqual(Array.from(bytes));
  });

  it('devuelve un array vacío para la cadena vacía', () => {
    expect(urlBase64ToUint8Array('')).toHaveLength(0);
  });
});

describe('describeDevice', () => {
  it('etiqueta iPhone, iPad (también disfrazado de Mac), Android, PC y Otro', () => {
    expect(describeDevice(fakeNavigator({ userAgent: UA.iphoneSafari, touch: 5 }))).toBe('iPhone');
    expect(describeDevice(fakeNavigator({ userAgent: UA.ipadDesktop, touch: 5 }))).toBe('iPad');
    expect(describeDevice(fakeNavigator({ userAgent: UA.androidChrome, touch: 5 }))).toBe(
      'Android',
    );
    expect(describeDevice(fakeNavigator({ userAgent: UA.windowsChrome }))).toBe('PC');
    expect(describeDevice(fakeNavigator({ userAgent: UA.macSafari }))).toBe('PC');
    expect(
      describeDevice(fakeNavigator({ userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 5)' })),
    ).toBe('Otro');
  });
});
