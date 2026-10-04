import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../core/config';

export interface AuthUser {
  id: string;
  email: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${config.SESSION_COOKIE_NAME}=`));
    if (match) return decodeURIComponent(match.slice(config.SESSION_COOKIE_NAME.length + 1));
  }
  return null;
}

/** Populates req.user when a valid JWT is present; never rejects (use requireAuth for that). */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as { sub: string; email: string; role: string };
    req.user = { id: payload.sub, email: payload.email, role: payload.role as AuthUser['role'] };
  } catch {
    req.user = undefined;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) return void res.status(401).json({ error: 'Authentication required' });
  next();
}

export function requireRole(...roles: AuthUser['role'][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) return void res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) return void res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

/** Internal endpoints used by the workers. */
export function requireWorkerToken(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers['x-worker-token'] as string | undefined;
  if (!token || token !== config.WORKER_TOKEN) {
    return void res.status(401).json({ error: 'Invalid worker token' });
  }
  next();
}

/**
 * Scoring-provider auth: either an operator JWT (role OPERATOR/ADMIN) or the
 * dedicated X-Scoring-Api-Key header used by authorised data providers.
 */
export function requireScoringAccess(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-scoring-api-key'] as string | undefined;
  if (config.SCORING_API_KEY && key && timingSafeEqual(key, config.SCORING_API_KEY)) {
    req.user = req.user ?? { id: 'scoring-provider', email: 'scoring@provider', role: 'OPERATOR' };
    return next();
  }
  if (req.user && (req.user.role === 'ADMIN' || req.user.role === 'OPERATOR')) return next();
  return void res.status(401).json({ error: 'Valid operator session or X-Scoring-Api-Key required' });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
