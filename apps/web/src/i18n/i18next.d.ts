import 'i18next';

import type { defaultNS, resources } from './index';

// Tipado de claves: t("nav.caja") o <Trans i18nKey="x.y"> con una clave
// que no exista en es.json falla en `tsc`.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)['es'];
    returnNull: false;
  }
}
