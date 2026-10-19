import { Hono } from 'hono';

import { requireUserOrDevice } from '../auth/middleware.ts';
import type { AuthEnv } from '../auth/types.ts';
import type { CatalogService } from './service.ts';

/** GET /api/catalog: lo activo (servicios, productos y barberos) para la caja (dispositivo) y cualquier usuario. */
export const createCatalogRoutes = (catalog: CatalogService) =>
  new Hono<AuthEnv>().get('/', requireUserOrDevice(), async (c) => c.json(await catalog.catalog()));
