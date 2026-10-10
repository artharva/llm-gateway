import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { HttpError } from '../errors';

/** Validates req.body against a zod schema and stores the parsed value in res.locals.body. */
export function validateBody(schema: z.ZodType): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        'Request body is invalid',
        parsed.error.issues.map((i) => ({
          path: i.path.join('.') || '(body)',
          message: i.message,
        })),
      );
    }
    res.locals.body = parsed.data;
    next();
  };
}
