import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';

/** Validates body (and optionally query/params) and replaces req.body with the parsed value. */
export function validate(schema: ZodSchema, target: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse((req as unknown as Record<string, unknown>)[target]);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    (req as unknown as Record<string, unknown>)[target] = result.data;
    next();
  };
}
