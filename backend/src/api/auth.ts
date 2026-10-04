import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { prisma } from '../db/prisma';
import { config } from '../core/config';
import { logger } from '../core/logger';
import { signToken, requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { HttpError } from '../middleware/error';
import { createUserSchema, loginSchema } from '@matchcast/shared';

export const authRouter: Router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

authRouter.post('/login', loginLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Constant-ish time: always run a compare so timing does not leak account existence.
    const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok || !user.isActive) {
      logger.warn('backend', 'Failed login attempt', { email });
      throw new HttpError(401, 'Invalid email or password');
    }
    const token = signToken({ id: user.id, email: user.email, role: user.role });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    res
      .cookie(config.SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.COOKIE_SECURE,
        maxAge: 12 * 60 * 60 * 1000,
      })
      .json({
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(config.SESSION_COOKIE_NAME);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/** Creating users requires an authenticated ADMIN (the first admin is seeded). */
authRouter.post('/register', requireAuth, requireRole('ADMIN'), validate(createUserSchema), async (req, res, next) => {
  try {
    const { email, password, name, role } = req.body as { email: string; password: string; name: string; role: 'ADMIN' | 'OPERATOR' | 'VIEWER' };
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) throw new HttpError(409, 'User already exists');
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email: email.toLowerCase(), name, passwordHash, role },
    });
    logger.info('backend', `User created: ${user.email}`, { role });
    res.status(201).json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    next(err);
  }
});
