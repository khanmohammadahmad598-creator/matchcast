import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { prisma } from '../db/prisma';
import { config } from '../core/config';
import { logger } from '../core/logger';
import { signToken, requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { HttpError } from '../middleware/error';
import { changePasswordSchema, createUserSchema, loginSchema } from '@matchcast/shared';

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

/**
 * POST /api/auth/change-password
 * Lets an authenticated operator rotate their own password. The current
 * password must be presented, so a stolen (but expired) session cannot lock an
 * operator out of their account.
 */
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password change attempts, please try again later' },
});

authRouter.post(
  '/change-password',
  changePasswordLimiter,
  requireAuth,
  validate(changePasswordSchema),
  async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      if (!user || !user.isActive) throw new HttpError(401, 'Account not found or disabled');

      const ok = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!ok) {
        logger.warn('backend', 'Rejected password change - wrong current password', { email: user.email });
        throw new HttpError(401, 'Current password is incorrect');
      }
      if (await bcrypt.compare(newPassword, user.passwordHash)) {
        throw new HttpError(400, 'The new password must be different from the current one');
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(newPassword, 12) },
      });

      // The old cookie/JWT still works until it expires, but this session's
      // cookie is refreshed so an operator is not signed out by their own change.
      const token = signToken({ id: user.id, email: user.email, role: user.role });
      logger.info('backend', 'Password changed', { email: user.email });

      res
        .cookie(config.SESSION_COOKIE_NAME, token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: config.COOKIE_SECURE,
          maxAge: 12 * 60 * 60 * 1000,
        })
        .json({ ok: true, token });
    } catch (err) {
      next(err);
    }
  },
);
