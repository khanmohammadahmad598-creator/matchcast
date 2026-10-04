import { defineConfig } from 'vitest/config';

/**
 * Backend tests run against a real PostgreSQL database (see .env.test or the
 * dev .env) so that the Prisma schema, constraints and API validation are all
 * exercised the way they behave in production.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // One DB, one Prisma client: parallel suites would fight over fixtures.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
