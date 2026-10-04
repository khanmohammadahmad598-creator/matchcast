import { PrismaClient } from '@prisma/client';
import { logger } from '../core/logger';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { level: 'warn', emit: 'stdout' },
      { level: 'error', emit: 'stdout' },
    ],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export async function connectDatabase(retries = 10): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await prisma.$connect();
      logger.info('backend', 'Connected to PostgreSQL');
      return;
    } catch (err) {
      lastError = err;
      const wait = Math.min(8000, 500 * attempt);
      logger.warn('backend', `PostgreSQL not ready (attempt ${attempt}/${retries}), retrying in ${wait}ms`, {
        error: (err as Error).message,
      });
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastError;
}
