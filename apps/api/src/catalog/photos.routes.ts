import { PHOTO_MAX_BYTES } from '@los-papis/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { requireRole, requireUserOrDevice } from '../auth/middleware.ts';
import type { AuthEnv } from '../auth/types.ts';
import { idParam } from '../auth/validate.ts';
import type { CatalogService } from './service.ts';

/**
 * /api/photos/*: subir (managers, cuerpo binario `image/*` de 400 KB como máximo) y servir (usuarios y
 * dispositivos de caja). Las fotos son inmutables, así que se cachean un año por su URL; `private` porque la
 * petición lleva cookie. El ETag es el SHA-256 de los bytes: con If-None-Match se responde 304 sin cuerpo.
 */

const CACHE_CONTROL = 'private, max-age=31536000, immutable';

/** If-None-Match: uno o varios ETags (débiles o no) separados por comas, o "*". */
const etagMatches = (header: string | undefined, etag: string): boolean =>
  header?.split(',').some((candidate) => {
    const value = candidate.trim().replace(/^W\//, '');
    return value === '*' || value === etag;
  }) ?? false;

export const createPhotoRoutes = (catalog: CatalogService) =>
  new Hono<AuthEnv>()
    .post(
      '/',
      requireRole('manager'),
      bodyLimit({
        maxSize: PHOTO_MAX_BYTES,
        onError: (c) => c.json({ error: 'photo_too_large' as const }, 413),
      }),
      async (c) => {
        const contentType = c.req.header('content-type') ?? '';
        if (!contentType.toLowerCase().startsWith('image/')) {
          return c.json({ error: 'photo_invalid' as const, reason: 'content_type' }, 400);
        }
        const bytes = new Uint8Array(await c.req.arrayBuffer());
        return c.json(await catalog.uploadPhoto(c.var.auth, bytes), 201);
      },
    )
    .get('/:id', requireUserOrDevice(), idParam(), async (c) => {
      const photo = await catalog.findPhoto(c.req.valid('param').id);
      if (!photo) return c.json({ error: 'not_found' as const }, 404);
      const etag = `"${photo.sha256}"`;
      const headers = { 'Cache-Control': CACHE_CONTROL, ETag: etag };
      if (etagMatches(c.req.header('if-none-match'), etag)) return c.body(null, 304, headers);
      return c.body(new Uint8Array(photo.bytes), 200, {
        ...headers,
        'Content-Type': photo.mime,
        'Content-Length': String(photo.sizeBytes),
      });
    });
