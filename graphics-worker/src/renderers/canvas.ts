import { createCanvas, loadImage, type Canvas, type Image as CanvasImage } from '@napi-rs/canvas';
import { logger } from '../core/logger';
import { config } from '../core/config';
import { drawShared, resolveTemplate } from '../templates';
import type { FlashGraphic, RenderContext } from './types';
import type { GraphicsSettings, ScoreSnapshot } from '@matchcast/shared';

export interface RenderInput {
  snapshot: ScoreSnapshot | null;
  settings: GraphicsSettings;
  flash: FlashGraphic | null;
}

/**
 * Renders the broadcast overlay with @napi-rs/canvas (Skia).
 * Output: raw RGBA bytes, exactly what FFmpeg expects from a `rawvideo` input.
 */
export class CanvasRenderer {
  private canvas: Canvas;
  private ctx: ReturnType<Canvas['getContext']>;
  private logos = new Map<string, CanvasImage | null>();
  private loading = new Set<string>();

  constructor(private width: number, private height: number) {
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');
  }

  get dimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');
    logger.info('system', `Overlay canvas resized to ${width}x${height}`);
  }

  /** Kicks off an async logo load; the frame renderer picks it up when ready. */
  preloadLogo(url?: string | null): void {
    if (!url || this.logos.has(url) || this.loading.has(url)) return;
    this.loading.add(url);
    void this.fetchImage(url)
      .then((img) => {
        this.logos.set(url, img);
        logger.debug('system', `Logo loaded: ${url.slice(0, 60)}`);
      })
      .catch(() => {
        this.logos.set(url, null);
        logger.warn('system', `Logo could not be loaded: ${url.slice(0, 60)}`);
      })
      .finally(() => this.loading.delete(url));
  }

  private async fetchImage(url: string): Promise<CanvasImage | null> {
    if (/^https?:\/\//.test(url)) {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return loadImage(Buffer.from(await res.arrayBuffer()));
    }
    if (url.startsWith('/media/')) {
      // Uploaded assets are stored by the backend; try disk first, then HTTP.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('node:fs') as typeof import('node:fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require('node:path') as typeof import('node:path');
      const local = path.join(config.MEDIA_DIR, path.basename(url));
      if (fs.existsSync(local)) return loadImage(fs.readFileSync(local));
      const res = await fetch(`${config.BACKEND_URL}${url}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return loadImage(Buffer.from(await res.arrayBuffer()));
    }
    if (url.startsWith('data:')) {
      const base64 = url.split(',')[1] ?? '';
      return loadImage(Buffer.from(base64, 'base64'));
    }
    return null;
  }

  private logoFor(url: string | null | undefined): CanvasImage | null {
    if (!url) return null;
    const cached = this.logos.get(url);
    if (cached !== undefined) return cached;
    this.preloadLogo(url);
    return null;
  }

  /** Draws one frame and returns RGBA bytes. */
  render(input: RenderInput): Buffer {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width, this.height);

    const context: RenderContext = {
      ctx: ctx as unknown as CanvasRenderingContext2D,
      width: this.width,
      height: this.height,
      snapshot: input.snapshot,
      settings: input.settings,
      now: Date.now(),
      flash: input.flash,
      logo: (url): unknown => this.logoFor(url),
    };

    try {
      resolveTemplate(input.settings.templateId).draw(context);
      drawShared(context);
    } catch (err) {
      // A broken template must never take the overlay down.
      logger.error('system', 'Template render failed', { error: (err as Error).message });
    }

    const data = ctx.getImageData(0, 0, this.width, this.height).data;
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
}
