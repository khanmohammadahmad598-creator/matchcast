import { config } from './config';
import { redactSecrets, scrub, type LogEntry, type LogLevel, type LogSource } from '@matchcast/shared';

const ORDER: Record<LogLevel, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40, FATAL: 50 };

type RemoteSink = (entry: LogEntry) => void;
let remote: RemoteSink | null = null;

export function setRemoteLogSink(sink: RemoteSink | null): void {
  remote = sink;
}

function emit(level: LogLevel, source: LogSource, message: string, meta?: Record<string, unknown> | null): void {
  if (ORDER[level] < ORDER[config.LOG_LEVEL as LogLevel]) return;
  const entry: LogEntry = {
    level,
    source,
    message: redactSecrets(message, [config.WORKER_TOKEN]),
    meta: meta ? (scrub(meta) as Record<string, unknown>) : null,
    createdAt: new Date().toISOString(),
  };
  const line = `[${entry.createdAt}] ${level.padEnd(5)} [${source}] ${entry.message}`;
  const metaStr = entry.meta ? ` ${JSON.stringify(entry.meta)}` : '';
  if (level === 'ERROR' || level === 'FATAL') console.error(line + metaStr);
  else if (level === 'WARN') console.warn(line + metaStr);
  else console.log(line + metaStr);
  try {
    remote?.(entry);
  } catch {
    /* ignore */
  }
}

export const logger = {
  debug: (source: LogSource, msg: string, meta?: Record<string, unknown> | null) => emit('DEBUG', source, msg, meta),
  info: (source: LogSource, msg: string, meta?: Record<string, unknown> | null) => emit('INFO', source, msg, meta),
  warn: (source: LogSource, msg: string, meta?: Record<string, unknown> | null) => emit('WARN', source, msg, meta),
  error: (source: LogSource, msg: string, meta?: Record<string, unknown> | null) => emit('ERROR', source, msg, meta),
  fatal: (source: LogSource, msg: string, meta?: Record<string, unknown> | null) => emit('FATAL', source, msg, meta),
};
