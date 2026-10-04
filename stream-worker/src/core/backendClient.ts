import { config } from './config';
import { logger } from './logger';
import type { LogEntry, ReplayClip, StreamStatus, WorkerStatus } from '@matchcast/shared';

/**
 * Thin HTTP client for the control plane. Every call is best-effort:
 * a backend outage must never interrupt a live broadcast.
 */
export class BackendClient {
  private queue: LogEntry[] = [];
  private flushing = false;
  private logShippingSuppressed = false;

  constructor(private baseUrl: string = config.BACKEND_URL, private token: string = config.WORKER_TOKEN) {}

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', 'x-worker-token': this.token };
  }

  private async request<T>(
    method: 'POST' | 'PATCH',
    path: string,
    body: unknown,
    timeoutMs = 4000,
  ): Promise<T | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        this.noteFailure(path, `${method} ${path} -> ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      this.noteFailure(path, `${method} ${path} failed`, (err as Error).message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private post<T>(path: string, body: unknown, timeoutMs = 4000): Promise<T | null> {
    return this.request<T>('POST', path, body, timeoutMs);
  }

  private patch<T>(path: string, body: unknown, timeoutMs = 4000): Promise<T | null> {
    return this.request<T>('PATCH', path, body, timeoutMs);
  }

  /**
   * Log-shipping failures must not be logged themselves: the log entry would
   * be shipped, fail again, and produce an endless feedback loop while the
   * backend is down. Instead we back off silently and report once.
   */
  private noteFailure(path: string, message: string, detail?: string): void {
    if (path === '/api/internal/logs') {
      if (!this.logShippingSuppressed) {
        this.logShippingSuppressed = true;
        logger.warn('backend', 'Log shipping unavailable - buffering locally', { detail: detail ?? null });
        setTimeout(() => {
          this.logShippingSuppressed = false;
        }, 30_000).unref();
      }
      return;
    }
    logger.debug('backend', message, { detail: detail ?? null });
  }

  private async get<T>(path: string, timeoutMs = 4000): Promise<T | null> {
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

  /** Batched, non-blocking log shipping. */
  log(entry: LogEntry): void {
    this.queue.push(entry);
    if (this.queue.length > 100) this.queue.shift();
    void this.flushLogs();
  }

  private async flushLogs(): Promise<void> {
    if (this.flushing || !this.queue.length || this.logShippingSuppressed) return;
    this.flushing = true;
    const batch = this.queue.splice(0, 25);
    try {
      for (const entry of batch) {
        await this.post('/api/internal/logs', entry, 2500);
      }
    } finally {
      this.flushing = false;
    }
    if (this.queue.length) setTimeout(() => void this.flushLogs(), 300);
  }

  bootstrap() {
    return this.get<{
      stream?: { shouldRun: boolean };
      ai: unknown;
      tts: unknown;
      audio: unknown;
      graphics: unknown;
      output: unknown;
      input: unknown;
      replay: unknown;
      snapshot: unknown;
    }>('/api/internal/bootstrap', 8000);
  }

  reportStreamStatus(status: StreamStatus): void {
    void this.post('/api/internal/stream/status', status);
  }

  reportWorkerStatus(status: WorkerStatus): void {
    void this.post('/api/internal/worker/status', status);
  }

  saveCommentary(input: {
    text: string;
    language: string;
    style: string;
    provider: string;
    eventType?: string | null;
    matchId?: string;
  }) {
    return this.post<{ item: { id: string } }>('/api/internal/commentary', input);
  }

  patchCommentary(id: string, patch: { ttsStatus?: string; audioUrl?: string | null; durationMs?: number | null; spoken?: boolean }) {
    return this.patch('/api/internal/commentary', { id, ...patch }, 3000);
  }

  registerTtsAudio(input: {
    provider: string;
    voice?: string | null;
    language?: string | null;
    text: string;
    cacheKey: string;
    filePath: string;
    format: string;
    durationMs?: number | null;
    sizeBytes?: number | null;
    commentaryId?: string | null;
  }) {
    return this.post('/api/internal/tts-audio', input, 3000);
  }

  createReplayClip(input: { matchId: string; eventType: string; filePath: string; durationSeconds: number; inserted?: boolean }) {
    return this.post<{ clip: ReplayClip }>('/api/internal/replay-clip', input, 4000);
  }

  async fetchJson<T>(url: string): Promise<T | null> {
    try {
      const res = await fetch(url);
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }
}

export const backend = new BackendClient();
