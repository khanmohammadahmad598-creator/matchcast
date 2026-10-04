import { config } from './config';
import { logger } from './logger';
import type { LogEntry, WorkerStatus } from '@matchcast/shared';

/** Minimal control-plane client for the graphics worker. */
export class BackendClient {
  constructor(private baseUrl: string = config.BACKEND_URL, private token: string = config.WORKER_TOKEN) {}

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', 'x-worker-token': this.token };
  }

  async post(path: string, body: unknown, timeoutMs = 3000): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async get<T>(path: string, timeoutMs = 6000): Promise<T | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers(), signal: ctrl.signal });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch (err) {
      logger.debug('backend', `GET ${path} failed`, { error: (err as Error).message });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  log(entry: LogEntry): void {
    void this.post('/api/internal/logs', entry, 2500);
  }

  reportStatus(status: WorkerStatus): void {
    void this.post('/api/internal/worker/status', status);
  }

  bootstrap() {
    return this.get<{ graphics?: unknown; snapshot?: unknown }>('/api/internal/bootstrap', 8000);
  }
}

export const backend = new BackendClient();
