import fs from 'node:fs';
import { config } from '../core/config';
import { logger } from '../core/logger';
import type { ConnectionState, InputKind, InputStatus, StreamInputSettings } from '@matchcast/shared';

/**
 * Owns everything about the *source* side of the pipeline:
 * arg building, connection state, reconnect counting and telemetry.
 *
 * Compliance: only operator-attested, licensed inputs are accepted. The backend
 * refuses to store a source without `rightsAttested`, and the worker refuses to
 * open a network source that was not attested.
 */
export class InputManager {
  private settings: StreamInputSettings = {
    kind: 'demo',
    url: '',
    lowLatency: true,
    readTimeoutSeconds: 10,
    rightsAttested: false,
    rightsNote: null,
  };

  private status: InputStatus = {
    kind: 'demo',
    state: 'IDLE',
    url: '',
    bitrateKbps: 0,
    fps: 0,
    droppedFrames: 0,
    reconnectCount: 0,
    lastError: null,
    updatedAt: new Date().toISOString(),
  };

  getStatus(): InputStatus {
    return this.status;
  }

  getSettings(): StreamInputSettings {
    return this.settings;
  }

  setSettings(next: Partial<StreamInputSettings>): void {
    this.settings = { ...this.settings, ...next };
    this.status = { ...this.status, kind: this.settings.kind, url: this.settings.url };
  }

  setState(state: ConnectionState, error?: string | null): void {
    this.status = { ...this.status, state, lastError: error ?? this.status.lastError, updatedAt: new Date().toISOString() };
    if (state === 'CONNECTED') this.status.lastConnectedAt = new Date().toISOString();
  }

  noteReconnect(reason: string): void {
    this.status = {
      ...this.status,
      reconnectCount: this.status.reconnectCount + 1,
      lastError: reason,
      state: 'RECONNECTING',
      updatedAt: new Date().toISOString(),
    };
    logger.warn('ffmpeg', `Input reconnect #${this.status.reconnectCount}: ${reason}`);
  }

  updateTelemetry(patch: Partial<InputStatus>): void {
    this.status = { ...this.status, ...patch, updatedAt: new Date().toISOString() };
  }

  /** Throws when the configured source is not allowed / not usable. */
  validate(): void {
    const { kind, url } = this.settings;

    // Local files / demo mode may leave the URL empty (falls back to DEMO_VIDEO).
    if (kind === 'file' || kind === 'demo') {
      const resolved = this.resolveFileUrl();
      if (!resolved || !fs.existsSync(resolved)) {
        throw new Error(
          `Input file not found: ${resolved || '(empty)'} - run scripts/make-demo-asset.sh or set a source URL`,
        );
      }
      return;
    }

    if (!url) throw new Error('Input URL is empty - set an input source in the dashboard');
    if (!this.settings.rightsAttested) {
      throw new Error(
        'Source is not rights-attested. Only feeds you own or are licensed to broadcast may be ingested.',
      );
    }
  }

  private resolveFileUrl(): string {
    const raw = this.settings.url || config.DEMO_VIDEO;
    return raw.replace(/^file:\/\//, '');
  }

  /** FFmpeg input arguments for the configured source. */
  args(): string[] {
    const { kind, lowLatency, readTimeoutSeconds } = this.settings;
    const timeout = `1000000${String(Math.max(1, readTimeoutSeconds * 1000000)).slice(-7)}`;
    switch (kind) {
      case 'rtmp':
        return [
          ...(lowLatency ? ['-fflags', 'nobuffer', '-flags', 'low_delay'] : []),
          '-rw_timeout', timeout,
          '-i', this.settings.url,
        ];
      case 'srt':
        return [
          '-rw_timeout', timeout,
          ...(lowLatency ? ['-fflags', 'nobuffer'] : []),
          '-i', this.settings.url.includes('?') ? this.settings.url : `${this.settings.url}?latency=200000&transtype=live`,
        ];
      case 'hls':
        return [
          ...(lowLatency ? ['-fflags', 'nobuffer'] : []),
          '-rw_timeout', timeout,
          '-i', this.settings.url,
        ];
      case 'device': {
        const url = this.settings.url;
        if (url.startsWith(':') || url.includes('x11')) {
          return ['-f', 'x11grab', '-framerate', '30', '-video_size', '1920x1080', '-i', url];
        }
        if (url.startsWith('/dev/video')) {
          return ['-f', 'v4l2', '-framerate', '30', '-video_size', '1280x720', '-i', url];
        }
        if (url.startsWith('/dev/snd') || url.includes('alsa') || url.includes('pulse')) {
          return ['-f', 'alsa', '-i', url];
        }
        // DirectShow / AVFoundation / anything else: pass through as-is.
        return ['-i', url];
      }
      case 'file':
      case 'demo':
      default:
        // Loop forever so the pipeline survives the end of the file (demo + tests).
        return ['-stream_loop', '-1', '-re', '-i', this.resolveFileUrl()];
    }
  }

  /** Human label used in logs (never contains credentials). */
  describe(): string {
    const { kind } = this.settings;
    if (kind === 'file' || kind === 'demo') return `${kind}:${this.resolveFileUrl()}`;
    const u = this.settings.url;
    try {
      const parsed = new URL(u.replace(/^(rtmp|rtmps|srt|http|https):\/\//, 'https://'));
      return `${kind}:${parsed.host}${parsed.pathname}`;
    } catch {
      return `${kind}:${u.slice(0, 40)}`;
    }
  }

  kindIs(kind: InputKind): boolean {
    return this.settings.kind === kind;
  }
}
