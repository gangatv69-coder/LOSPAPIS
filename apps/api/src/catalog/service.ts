import { createHash } from 'node:crypto';

import {
  and,
  asc,
  type BarberRow,
  barbers,
  desc,
  eq,
  isNotNull,
  isNull,
  ne,
  type Photo,
  type ProductRow,
  photos,
  products,
  type ServiceRow,
  services,
  type Tx,
  type User,
  users,
  withShop,
} from '@los-papis/db';
import {
  type Barber,
  type BarberInput,
  type BarberUpdate,
  barberColorSchema,
  type Catalog,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_SIDE,
  PHOTO_MIMES,
  type PhotoMime,
  type PhotoSummary,
  type Product,
  type ProductInput,
  type ProductUpdate,
  photoUrl,
  type Service,
  type ServiceInput,
  type ServiceUpdate,
  toRomeIso,
  type UserSummary,
} from '@los-papis/shared';

import { type AuditInput, audit } from '../auth/audit.ts';
import { AuthError } from '../auth/errors.ts';
import { type Action, can } from '../auth/permissions.ts';
import { toUserSummary } from '../auth/service.ts';
import type { AuthContext, AuthDeps } from '../auth/types.ts';
import { sniffImage } from './images.ts';

/**
 * Catálogo y equipo (LP-08) sin HTTP: servicios, productos, barberos y fotos. Mismo patrón que el acceso: cada
 * método abre su transacción con la barbería fijada (`withShop`) y deja la auditoría dentro de ella. Nada se
 * borra (se desactiva) y cada cambio de precio queda con el valor anterior y el nuevo (`*.price_changed`).
 */

/** Paso entre posiciones de la rejilla (el mismo que el seed): deja hueco para intercalar sin renumerar. */
const SORT_STEP = 10;

const iso = (date: Date): string => toRomeIso(date);

export const toService = (row: ServiceRow): Service => ({
  id: row.id,
  nameEs: row.nameEs,
  nameIt: row.nameIt,
  priceCents: row.priceCents,
  durationMinutes: row.durationMinutes,
  active: row.active,
  sortOrder: row.sortOrder,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

export const toProduct = (row: ProductRow): Product => ({
  id: row.id,
  name: row.name,
  priceCents: row.priceCents,
  photoId: row.photoId,
  photoUrl: row.photoId ? photoUrl(row.photoId) : null,
  active: row.active,
  sortOrder: row.sortOrder,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

export const toBarber = (row: BarberRow): Barber => ({
  id: row.id,
  userId: row.userId,
  displayName: row.displayName,
  shortCode: row.shortCode,
  // En la base es texto; solo entra por barberInputSchema, así que siempre es uno de la paleta.
  color: barberColorSchema.parse(row.color),
  photoId: row.photoId,
  photoUrl: row.photoId ? photoUrl(row.photoId) : null,
  active: row.active,
  sortOrder: row.sortOrder,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

export const toPhotoSummary = (
  photo: Pick<Photo, 'id' | 'width' | 'height' | 'sizeBytes'> & { mime: PhotoMime },
): PhotoSummary => ({
  id: photo.id,
  mime: photo.mime,
  width: photo.width,
  height: photo.height,
  sizeBytes: photo.sizeBytes,
  url: photoUrl(photo.id),
});

/** Usuario de la sesión con permiso para `action` (las guardias de las rutas ya lo exigen; se vuelve a comprobar). */
const actorWith = (ctx: AuthContext, action: Action): User => {
  if (!ctx.session || !ctx.user) throw new AuthError('unauthenticated', 401);
  if (ctx.session.totpPending) throw new AuthError('totp_required', 401);
  if (!can(ctx.user.role, action)) throw new AuthError('forbidden', 403);
  return ctx.user;
};

type Changes<T> = { set: Partial<T>; before: Partial<T>; after: Partial<T> };

/** Campos del parche que cambian de verdad respecto a la fila: van al UPDATE y a la auditoría (antes/después). */
const changesOf = <T extends object>(row: T, patch: Partial<T>): Changes<T> => {
  const result: Changes<T> = { set: {}, before: {}, after: {} };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value === undefined || value === row[key]) continue;
    result.set[key] = value;
    result.before[key] = row[key];
    result.after[key] = value;
  }
  return result;
};

const hasChanges = <T>({ set }: Changes<T>): boolean => Object.keys(set).length > 0;

type Entity = 'service' | 'product' | 'barber';

type PatchEvent = Pick<
  AuditInput,
  'shopId' | 'actorUserId' | 'entityId' | 'deviceId' | 'occurredAt'
>;

/** Auditoría de un parche: el precio va en su propio evento (antes/después) y el resto de campos en `*.updated`. */
const auditPatch = async (
  tx: Tx,
  entity: Entity,
  event: PatchEvent,
  { before, after }: { before: Record<string, unknown>; after: Record<string, unknown> },
): Promise<void> => {
  const { priceCents: priceBefore, ...otherBefore } = before;
  const { priceCents: priceAfter, ...otherAfter } = after;
  if (priceAfter !== undefined && entity !== 'barber') {
    await audit(tx, {
      ...event,
      action: `${entity}.price_changed` as const,
      entityType: entity,
      before: { priceCents: priceBefore },
      after: { priceCents: priceAfter },
    });
  }
  if (Object.keys(otherAfter).length > 0) {
    await audit(tx, {
      ...event,
      action: `${entity}.updated` as const,
      entityType: entity,
      before: otherBefore,
      after: otherAfter,
    });
  }
};

/** Nombre del índice de un SQLSTATE 23505 (unique_violation), directo o envuelto por Drizzle en `cause`. */
const uniqueViolationIndex = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const { code, constraint, cause } = error as {
    code?: unknown;
    constraint?: unknown;
    cause?: unknown;
  };
  if (code === '23505') return typeof constraint === 'string' ? constraint : '';
  return uniqueViolationIndex(cause);
};

/** Carrera con otra alta o reactivación: los índices únicos de `barbers` la paran y aquí se traduce a 409. */
const barberConflict = (error: unknown): AuthError | undefined => {
  const index = uniqueViolationIndex(error);
  if (index === undefined) return undefined;
  if (index.includes('user_id')) return new AuthError('user_already_barber', 409);
  if (index.includes('short_code')) return new AuthError('short_code_taken', 409);
  return undefined;
};

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export const createCatalogService = (deps: AuthDeps) => {
  const { db, shop } = deps;
  const now = deps.now ?? (() => new Date());
  const shopId = shop.id;

  const run = async <T>(fn: (tx: Tx, at: Date) => Promise<T | AuthError>): Promise<T> => {
    const at = now();
    const result = await withShop(db, shopId, (tx) => fn(tx, at));
    if (result instanceof AuthError) throw result;
    return result;
  };

  const runBarber = async <T>(fn: (tx: Tx, at: Date) => Promise<T | AuthError>): Promise<T> => {
    try {
      return await run(fn);
    } catch (error) {
      throw barberConflict(error) ?? error;
    }
  };

  /** Siguiente hueco al final de la rejilla: el mayor sortOrder más el paso. */
  const nextSortOrder = async (
    tx: Tx,
    table: typeof services | typeof products | typeof barbers,
  ): Promise<number> => {
    const [last] = await tx
      .select({ sortOrder: table.sortOrder })
      .from(table)
      .orderBy(desc(table.sortOrder))
      .limit(1);
    return (last?.sortOrder ?? 0) + SORT_STEP;
  };

  const findService = async (tx: Tx, id: string): Promise<ServiceRow> => {
    const [row] = await tx.select().from(services).where(eq(services.id, id));
    if (!row) throw new AuthError('not_found', 404);
    return row;
  };

  const findProduct = async (tx: Tx, id: string): Promise<ProductRow> => {
    const [row] = await tx.select().from(products).where(eq(products.id, id));
    if (!row) throw new AuthError('not_found', 404);
    return row;
  };

  const findBarber = async (tx: Tx, id: string): Promise<BarberRow> => {
    const [row] = await tx.select().from(barbers).where(eq(barbers.id, id));
    if (!row) throw new AuthError('not_found', 404);
    return row;
  };

  /** La foto tiene que existir en esta barbería (la RLS esconde las de otras). */
  const assertPhoto = async (tx: Tx, photoId: string): Promise<void> => {
    const [photo] = await tx.select({ id: photos.id }).from(photos).where(eq(photos.id, photoId));
    if (!photo) throw new AuthError('not_found', 404, { entity: 'photo' });
  };

  /** El código corto solo tiene que ser único entre los barberos ACTIVOS (índice parcial). */
  const shortCodeTaken = async (tx: Tx, shortCode: string, exceptId?: string): Promise<boolean> => {
    const [row] = await tx
      .select({ id: barbers.id })
      .from(barbers)
      .where(
        and(
          eq(barbers.shortCode, shortCode),
          eq(barbers.active, true),
          exceptId ? ne(barbers.id, exceptId) : undefined,
        ),
      );
    return row !== undefined;
  };

  return {
    /** GET /api/catalog: solo lo activo, en el orden de la rejilla. Lo leen la caja (dispositivo) y los usuarios. */
    catalog: (): Promise<Catalog> =>
      run<Catalog>(async (tx) => ({
        services: (
          await tx
            .select()
            .from(services)
            .where(eq(services.active, true))
            .orderBy(asc(services.sortOrder), asc(services.id))
        ).map(toService),
        products: (
          await tx
            .select()
            .from(products)
            .where(eq(products.active, true))
            .orderBy(asc(products.sortOrder), asc(products.id))
        ).map(toProduct),
        barbers: (
          await tx
            .select()
            .from(barbers)
            .where(eq(barbers.active, true))
            .orderBy(asc(barbers.sortOrder), asc(barbers.id))
        ).map(toBarber),
      })),

    // --- Servicios ---------------------------------------------------------------------------

    /** Todos (los inactivos al final), para la pantalla de gestión. */
    listServices: (): Promise<Service[]> =>
      run<Service[]>(async (tx) =>
        (
          await tx
            .select()
            .from(services)
            .orderBy(desc(services.active), asc(services.sortOrder), asc(services.id))
        ).map(toService),
      ),

    createService: (ctx: AuthContext, input: ServiceInput): Promise<Service> =>
      run<Service>(async (tx, at) => {
        const actor = actorWith(ctx, 'inventario');
        const [created] = await tx
          .insert(services)
          .values({
            shopId,
            ...input,
            sortOrder: await nextSortOrder(tx, services),
            createdAt: at,
            updatedAt: at,
          })
          .returning();
        if (!created) throw new Error('No se pudo crear el servicio');
        await audit(tx, {
          shopId,
          actorUserId: actor.id,
          action: 'service.created',
          entityType: 'service',
          entityId: created.id,
          after: { ...input },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return toService(created);
      }),

    /** Parche parcial. Un precio distinto deja `service.price_changed`; el resto de cambios, `service.updated`. */
    updateService: (ctx: AuthContext, id: string, patch: ServiceUpdate): Promise<Service> =>
      run<Service>(async (tx, at) => {
        const actor = actorWith(ctx, 'inventario');
        const row = await findService(tx, id);
        const changes = changesOf(row, patch);
        if (!hasChanges(changes)) return toService(row);
        const [updated] = await tx
          .update(services)
          .set({ ...changes.set, updatedAt: at })
          .where(eq(services.id, row.id))
          .returning();
        if (!updated) throw new Error('El servicio ha desaparecido al actualizarlo');
        await auditPatch(
          tx,
          'service',
          {
            shopId,
            actorUserId: actor.id,
            entityId: row.id,
            deviceId: ctx.device?.id,
            occurredAt: at,
          },
          changes,
        );
        return toService(updated);
      }),

    /** Desactivar o reactivar (nunca borrar). Si ya está así, devuelve la fila sin tocar nada. */
    setServiceActive: (ctx: AuthContext, id: string, active: boolean): Promise<Service> =>
      run<Service>(async (tx, at) => {
        const actor = actorWith(ctx, 'inventario');
        const row = await findService(tx, id);
        if (row.active === active) return toService(row);
        const [updated] = await tx
          .update(services)
          .set({ active, updatedAt: at })
          .where(eq(services.id, row.id))
          .returning();
        await audit(tx, {
          shopId,
          actorUserId: actor.id,
          action: active ? 'service.reactivated' : 'service.deactivated',
          entityType: 'service',
          entityId: row.id,
          before: { active: row.active },
          after: { active },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return toService(updated ?? { ...row, active, updatedAt: at });
      }),

    // --- Productos ---------------------------------------------------------------------------

    listProducts: (): Promise<Product[]> =>
      run<Product[]>(async (tx) =>
        (
          await tx
            .select()
            .from(products)
            .orderBy(desc(products.active), asc(products.sortOrder), asc(products.id))
        ).map(toProduct),
      ),

    createProduct: (ctx: AuthContext, input: ProductInput): Promise<Product> =>
      run<Product>(async (tx, at) => {
        const actor = actorWith(ctx, 'inventario');
        const photoId = input.photoId ?? null;
        if (photoId) await assertPhoto(tx, photoId);
        const [created] = await tx
          .insert(products)
          .values({
            shopId,
            name: input.name,
            priceCents: input.priceCents,
            photoId,
            sortOrder: await nextSortOrder(tx, products),
            createdAt: at,
            updatedAt: at,
          })
          .returning();
        if (!created) throw new Error('No se pudo crear el producto');
        await audit(tx, {
          shopId,
          actorUserId: actor.id,
          action: 'product.created',
          entityType: 'product',
          entityId: created.id,
          after: { name: created.name, priceCents: created.priceCents, photoId },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return toProduct(created);
      }),

    updateProduct: (ctx: AuthContext, id: string, patch: ProductUpdate): Promise<Product> =>
      run<Product>(async (tx, at) => {
        const actor = actorWith(ctx, 'inventario');
        const row = await findProduct(tx, id);
        const changes = changesOf(row, patch);
        if (!hasChanges(changes)) return toProduct(row);
        if (changes.set.photoId) await assertPhoto(tx, changes.set.photoId);
        const [updated] = await tx
          .update(products)
          .set({ ...changes.set, updatedAt: at })
          .where(eq(products.id, row.id))
          .returning();
        if (!updated) throw new Error('El producto ha desaparecido al actualizarlo');
        await auditPatch(
          tx,
          'product',
          {
            shopId,
            actorUserId: actor.id,
            entityId: row.id,
            deviceId: ctx.device?.id,
            occurredAt: at,
          },
          changes,
        );
        return toProduct(updated);
      }),

    setProductActive: (ctx: AuthContext, id: string, active: boolean): Promise<Product> =>
      run<Product>(async (tx, at) => {
        const actor = actorWith(ctx, 'inventario');
        const row = await findProduct(tx, id);
        if (row.active === active) return toProduct(row);
        const [updated] = await tx
          .update(products)
          .set({ active, updatedAt: at })
          .where(eq(products.id, row.id))
          .returning();
        await audit(tx, {
          shopId,
          actorUserId: actor.id,
          action: active ? 'product.reactivated' : 'product.deactivated',
          entityType: 'product',
          entityId: row.id,
          before: { active: row.active },
          after: { active },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return toProduct(updated ?? { ...row, active, updatedAt: at });
      }),

    // --- Barberos ----------------------------------------------------------------------------

    listBarbers: (): Promise<Barber[]> =>
      run<Barber[]>(async (tx) =>
        (
          await tx
            .select()
            .from(barbers)
            .orderBy(desc(barbers.active), asc(barbers.sortOrder), asc(barbers.id))
        ).map(toBarber),
      ),

    /** Usuarios activos con cuenta y sin perfil de barbero (también managers: uno puede cortar). */
    barberCandidates: (): Promise<UserSummary[]> =>
      run<UserSummary[]>(async (tx) => {
        const rows = await tx
          .select({ user: users })
          .from(users)
          .leftJoin(barbers, eq(barbers.userId, users.id))
          .where(and(eq(users.active, true), isNotNull(users.username), isNull(barbers.id)))
          .orderBy(asc(users.displayName), asc(users.id));
        return rows.map((row) => toUserSummary(row.user));
      }),

    /**
     * Perfil nuevo para un usuario activo con cuenta de esta barbería. Una persona = un perfil (409
     * `user_already_barber`) y el código corto no se repite entre activos (409 `short_code_taken`).
     */
    createBarber: (ctx: AuthContext, input: BarberInput): Promise<Barber> =>
      runBarber<Barber>(async (tx, at) => {
        const actor = actorWith(ctx, 'usuarios');
        const [user] = await tx.select().from(users).where(eq(users.id, input.userId));
        if (!user?.active || user.username === null) {
          throw new AuthError('not_found', 404, { entity: 'user' });
        }
        const [existing] = await tx
          .select({ id: barbers.id })
          .from(barbers)
          .where(eq(barbers.userId, user.id));
        if (existing) throw new AuthError('user_already_barber', 409);
        if (await shortCodeTaken(tx, input.shortCode)) {
          throw new AuthError('short_code_taken', 409, { shortCode: input.shortCode });
        }
        const photoId = input.photoId ?? null;
        if (photoId) await assertPhoto(tx, photoId);
        const [created] = await tx
          .insert(barbers)
          .values({
            shopId,
            userId: user.id,
            displayName: input.displayName,
            shortCode: input.shortCode,
            color: input.color,
            photoId,
            sortOrder: await nextSortOrder(tx, barbers),
            createdAt: at,
            updatedAt: at,
          })
          .returning();
        if (!created) throw new Error('No se pudo crear el perfil de barbero');
        await audit(tx, {
          shopId,
          actorUserId: actor.id,
          action: 'barber.created',
          entityType: 'barber',
          entityId: created.id,
          after: {
            userId: created.userId,
            displayName: created.displayName,
            shortCode: created.shortCode,
            color: created.color,
            photoId,
          },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return toBarber(created);
      }),

    updateBarber: (ctx: AuthContext, id: string, patch: BarberUpdate): Promise<Barber> =>
      runBarber<Barber>(async (tx, at) => {
        const actor = actorWith(ctx, 'usuarios');
        const row = await findBarber(tx, id);
        const changes = changesOf(row, patch);
        if (!hasChanges(changes)) return toBarber(row);
        const shortCode = changes.set.shortCode;
        if (
          shortCode !== undefined &&
          row.active &&
          (await shortCodeTaken(tx, shortCode, row.id))
        ) {
          throw new AuthError('short_code_taken', 409, { shortCode });
        }
        if (changes.set.photoId) await assertPhoto(tx, changes.set.photoId);
        const [updated] = await tx
          .update(barbers)
          .set({ ...changes.set, updatedAt: at })
          .where(eq(barbers.id, row.id))
          .returning();
        if (!updated) throw new Error('El barbero ha desaparecido al actualizarlo');
        await auditPatch(
          tx,
          'barber',
          {
            shopId,
            actorUserId: actor.id,
            entityId: row.id,
            deviceId: ctx.device?.id,
            occurredAt: at,
          },
          changes,
        );
        return toBarber(updated);
      }),

    /** Desactivar libera el código corto; reactivar exige que siga libre (409 `short_code_taken` si no). */
    setBarberActive: (ctx: AuthContext, id: string, active: boolean): Promise<Barber> =>
      runBarber<Barber>(async (tx, at) => {
        const actor = actorWith(ctx, 'usuarios');
        const row = await findBarber(tx, id);
        if (row.active === active) return toBarber(row);
        if (active && (await shortCodeTaken(tx, row.shortCode))) {
          throw new AuthError('short_code_taken', 409, { shortCode: row.shortCode });
        }
        const [updated] = await tx
          .update(barbers)
          .set({ active, updatedAt: at })
          .where(eq(barbers.id, row.id))
          .returning();
        await audit(tx, {
          shopId,
          actorUserId: actor.id,
          action: active ? 'barber.reactivated' : 'barber.deactivated',
          entityType: 'barber',
          entityId: row.id,
          before: { active: row.active },
          after: { active },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return toBarber(updated ?? { ...row, active, updatedAt: at });
      }),

    // --- Fotos -------------------------------------------------------------------------------

    /**
     * Guarda los bytes tal cual (el navegador ya los redujo) tras comprobarlos: tipo por bytes mágicos, tamaño
     * y lado mayor. Las fotos son inmutables: cambiar la de un producto es subir otra (URL nueva).
     */
    uploadPhoto: (ctx: AuthContext, bytes: Uint8Array): Promise<PhotoSummary> =>
      run<PhotoSummary>(async (tx, at) => {
        const actor = actorWith(ctx, 'inventario');
        if (bytes.length > PHOTO_MAX_BYTES) {
          throw new AuthError('photo_too_large', 413, { maxBytes: PHOTO_MAX_BYTES });
        }
        const info = sniffImage(bytes);
        if (!info || !PHOTO_MIMES.includes(info.mime)) {
          throw new AuthError('photo_invalid', 400, { reason: 'format' });
        }
        if (info.width > PHOTO_MAX_SIDE || info.height > PHOTO_MAX_SIDE) {
          throw new AuthError('photo_invalid', 400, {
            reason: 'dimensions',
            width: info.width,
            height: info.height,
            maxSide: PHOTO_MAX_SIDE,
          });
        }
        const [created] = await tx
          .insert(photos)
          .values({
            shopId,
            mime: info.mime,
            width: info.width,
            height: info.height,
            sizeBytes: bytes.length,
            sha256: sha256Of(bytes),
            bytes: Buffer.from(bytes),
            createdByUserId: actor.id,
            createdAt: at,
          })
          .returning({ id: photos.id });
        if (!created) throw new Error('No se pudo guardar la foto');
        await audit(tx, {
          shopId,
          actorUserId: actor.id,
          action: 'photo.uploaded',
          entityType: 'photo',
          entityId: created.id,
          after: { ...info, sizeBytes: bytes.length },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return toPhotoSummary({ id: created.id, ...info, sizeBytes: bytes.length });
      }),

    /** Fila completa (con los bytes) para GET /api/photos/:id; undefined si no existe en esta barbería. */
    findPhoto: (id: string): Promise<Photo | undefined> =>
      run<Photo | undefined>(async (tx) => {
        const [photo] = await tx.select().from(photos).where(eq(photos.id, id));
        return photo;
      }),
  };
};

export type CatalogService = ReturnType<typeof createCatalogService>;
