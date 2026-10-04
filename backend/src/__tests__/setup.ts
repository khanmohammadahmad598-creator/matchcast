import 'dotenv/config';
import { beforeAll, afterAll } from 'vitest';
import { connectDatabase, prisma } from '../db/prisma';

/**
 * Loads backend/.env (dotenv/config above) and makes sure the database is
 * reachable before any suite runs.
 */
beforeAll(async () => {
  await connectDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});
