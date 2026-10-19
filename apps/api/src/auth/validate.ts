import { zValidator } from '@hono/zod-validator';
import * as z from 'zod';

/**
 * Validación de cuerpos y parámetros con los esquemas compartidos. A diferencia del zValidator a secas (que
 * devuelve el resultado de Zod tal cual), aquí el 400 lleva el código estable `validation` y los `issues`.
 */

export const jsonBody = <T extends z.ZodType>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'validation' as const, issues: result.error.issues }, 400);
    }
  });

const idParamSchema = z.object({ id: z.uuid() });

/** `:id` de la ruta tiene que ser un UUID. */
export const idParam = () =>
  zValidator('param', idParamSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'validation' as const, issues: result.error.issues }, 400);
    }
  });

/** Parámetros de la query (?day=2026-10-19): cada valor llega como texto; los repetidos, como lista. */
export const queryParams = <T extends z.ZodType>(schema: T) =>
  zValidator('query', schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'validation' as const, issues: result.error.issues }, 400);
    }
  });
