import type { PushDelivery, PushLanguage, PushSubscriptionJson } from '@los-papis/shared';

export type StoredSubscription = {
  subscription: PushSubscriptionJson;
  /** Etiqueta del dispositivo (iPhone, Android, PC...), para mostrarla en Ajustes. */
  device?: string;
  language: PushLanguage;
  createdAt: Date;
  lastDelivery?: PushDelivery;
};

export type NewSubscription = Omit<StoredSubscription, 'createdAt' | 'lastDelivery'>;

/** Lo que las rutas /api/push/* necesitan de un almacén de suscripciones; se identifica por `endpoint`. */
export interface PushStore {
  /** Crea o actualiza; si el endpoint ya existía conserva createdAt y lastDelivery. */
  upsert(entry: NewSubscription): StoredSubscription;
  get(endpoint: string): StoredSubscription | undefined;
  /** true si existía. */
  remove(endpoint: string): boolean;
  /** Sin efecto si el endpoint ya no está (pudo borrarse mientras se enviaba el aviso). */
  setDelivery(endpoint: string, delivery: PushDelivery): void;
  count(): number;
}

/**
 * Suscripciones en memoria (prueba S4): se pierden al reiniciar o redesplegar la API y hay que volver a activar
 * los avisos desde Ajustes. La versión persistente (tabla en PostgreSQL) llega con los avisos reales de citas y
 * cobros; las rutas solo dependen de la interfaz PushStore, así que el cambio no las toca.
 */
export class InMemoryPushStore implements PushStore {
  readonly #entries = new Map<string, StoredSubscription>();

  upsert(entry: NewSubscription): StoredSubscription {
    const endpoint = entry.subscription.endpoint;
    const previous = this.#entries.get(endpoint);
    const stored: StoredSubscription = {
      subscription: entry.subscription,
      device: entry.device,
      language: entry.language,
      createdAt: previous?.createdAt ?? new Date(),
      lastDelivery: previous?.lastDelivery,
    };
    this.#entries.set(endpoint, stored);
    return stored;
  }

  get(endpoint: string): StoredSubscription | undefined {
    return this.#entries.get(endpoint);
  }

  remove(endpoint: string): boolean {
    return this.#entries.delete(endpoint);
  }

  setDelivery(endpoint: string, delivery: PushDelivery): void {
    const entry = this.#entries.get(endpoint);
    if (entry) entry.lastDelivery = delivery;
  }

  count(): number {
    return this.#entries.size;
  }
}
