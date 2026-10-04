import { prisma } from '../db/prisma';
import { addLogSink } from '../core/logger';
import { EV, type LogEntry } from '@matchcast/shared';
import { io } from '../realtime/io';

const RING_SIZE = 500;
const ring: LogEntry[] = [];

/** Batched DB writer: one insertMany per flush keeps PostgreSQL happy under load. */
let pending: LogEntry[] = [];
let flushTimer: NodeJS.Timeout | null = null;

async function flush(): Promise<void> {
  if (!pending.length) return;
  const batch = pending;
  pending = [];
  try {
    await prisma.systemLog.createMany({
      data: batch.map((e) => ({
        level: e.level,
        source: e.source,
        message: e.message.slice(0, 2000),
        meta: (e.meta ?? undefined) as object | undefined,
      })),
    });
  } catch {
    /* logging must never break the stream */
  }
}

/** Guards against log -> websocket -> error -> log feedback loops. */
let emitting = false;

export function initLogService(): void {
  addLogSink((entry) => {
    ring.push(entry);
    if (ring.length > RING_SIZE) ring.shift();
    // Realtime fan-out to dashboards
    if (!emitting) {
      emitting = true;
      try {
        io.to('dashboard').emit(EV.LOG, entry);
      } catch {
        /* socket layer may not be ready yet */
      } finally {
        emitting = false;
      }
    }
    pending.push(entry);
    if (pending.length >= 20) void flush();
    else if (!flushTimer) flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, 1500);
  });
}

export function recentLogs(limit = 200, level?: string): LogEntry[] {
  const filtered = level ? ring.filter((l) => l.level === level) : ring;
  return filtered.slice(-limit).reverse();
}

export async function queryLogs(opts: {
  limit?: number;
  level?: string;
  source?: string;
  since?: Date;
}): Promise<LogEntry[]> {
  const rows = await prisma.systemLog.findMany({
    where: {
      ...(opts.level ? { level: opts.level } : {}),
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.since ? { createdAt: { gte: opts.since } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(1000, opts.limit ?? 200),
  });
  return rows.map((r) => ({
    id: r.id,
    level: r.level as LogEntry['level'],
    source: r.source as LogEntry['source'],
    message: r.message,
    meta: (r.meta as Record<string, unknown> | null) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}
