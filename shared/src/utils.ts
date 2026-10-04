import { SECRET_ENV_KEYS } from './constants';

/**
 * Universally unique id. Uses the Web Crypto implementation, which exists in
 * Node 20+ (globalThis.crypto) and in every modern browser - this module is
 * imported by the dashboard too, so it must stay free of node: imports.
 */
export const uid = (): string => {
  const webCrypto = globalThis.crypto;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  if (webCrypto?.getRandomValues) {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const nowIso = (): string => new Date().toISOString();

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with jitter, capped. */
export function backoffDelay(attempt: number, baseMs = 1000, capMs = 30_000): number {
  const raw = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(raw * (0.7 + Math.random() * 0.6));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Replace any known secret value found inside a string with ***. */
export function redactSecrets(input: string, extraSecrets: Array<string | undefined> = []): string {
  let out = input;
  for (const key of SECRET_ENV_KEYS) {
    const v = process.env[key];
    if (v && v.length > 3) out = out.split(v).join('***REDACTED***');
  }
  for (const s of extraSecrets) {
    if (s && s.length > 3) out = out.split(s).join('***REDACTED***');
  }
  return out;
}

/** Remove secret-looking keys from objects before logging/serialising. */
export function scrub<T>(obj: T, extraKeys: string[] = []): T {
  const deny = new Set([
    ...SECRET_ENV_KEYS.map((k) => k.toLowerCase()),
    'streamkey',
    'stream_key',
    'password',
    'passwordhash',
    'token',
    'authorization',
    'cookie',
    'apikey',
    'secret',
    ...extraKeys.map((k) => k.toLowerCase()),
  ]);
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const flat = k.replace(/[_-]/g, '').toLowerCase();
        if (deny.has(flat) || flat.includes('streamkey')) {
          out[k] = '***REDACTED***';
        } else if (v && typeof v === 'object') {
          out[k] = walk(v);
        } else if (typeof v === 'string') {
          out[k] = redactSecrets(v);
        } else {
          out[k] = v;
        }
      }
      return out;
    }
    return value;
  };
  return walk(obj) as T;
}

/** Never let an unhandled rejection take a long-running broadcast process down. */
export function installProcessGuards(onFatal: (err: Error, kind: string) => void): void {
  process.on('unhandledRejection', (reason) => {
    onFatal(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    onFatal(err, 'uncaughtException');
  });
}

export function parseOvers(input: string | number): number {
  if (typeof input === 'number') return input;
  const n = Number(input);
  if (!Number.isFinite(n)) throw new Error(`Invalid overs value: ${input}`);
  return n;
}

/** Very small template helper: "Hello {name}" + {name:'A'} */
export function fmt(template: string, vars: Record<string, string | number | undefined | null>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
}

export function bytesToMb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

export function pct(value: number, total: number): number {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}
