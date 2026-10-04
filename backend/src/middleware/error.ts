import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../core/logger';
import { ScoreError } from '../services/matchService';
import { StreamControlError } from '../services/streamService';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof ScoreError || err instanceof StreamControlError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  const status = typeof (err as { status?: number }).status === 'number' ? (err as { status: number }).status : 500;
  logger.error('backend', `Unhandled error on ${req.method} ${req.path}`, {
    error: message,
    status,
    stack: err instanceof Error ? err.stack?.split('\n').slice(1, 4).join(' | ') : undefined,
  });
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: message || 'Internal server error' });
}
