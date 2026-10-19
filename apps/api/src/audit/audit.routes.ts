import { auditQuerySchema } from '@los-papis/shared';
import { Hono } from 'hono';
import * as z from 'zod';

import { requirePermission } from '../auth/middleware.ts';
import type { AuthEnv } from '../auth/types.ts';
import { queryParams } from '../auth/validate.ts';
import { type AuditService, decodeAuditCursor } from './service.ts';

/**
 * La query del visor con el cursor ya leído: un cursor que no salió de esta API es un 400 `validation` más
 * (con su `issue` en `cursor`), igual que un tipo o un día mal escritos.
 */
const auditRequestSchema = auditQuerySchema.transform((query, ctx) => {
  if (query.cursor === undefined) return { ...query, cursor: null };
  const cursor = decodeAuditCursor(query.cursor);
  if (!cursor) {
    ctx.addIssue({ code: 'custom', path: ['cursor'], message: 'Cursor inválido' });
    return z.NEVER;
  }
  return { ...query, cursor };
});

/**
 * /api/audit: el visor de auditoría (LP-10), solo para managers (permiso `estadisticas`). Los filtros y la
 * paginación los describe `auditQuerySchema` de @los-papis/shared.
 */
export const createAuditRoutes = (auditService: AuditService) =>
  new Hono<AuthEnv>().get(
    '/',
    requirePermission('estadisticas'),
    queryParams(auditRequestSchema),
    async (c) => c.json(await auditService.list(c.req.valid('query'))),
  );
