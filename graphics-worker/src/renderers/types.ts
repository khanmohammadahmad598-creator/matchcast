import type { GraphicsSettings, ScoreSnapshot } from '@matchcast/shared';

export interface FlashGraphic {
  title: string;
  subtitle?: string | null;
  until: number;
}

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  snapshot: ScoreSnapshot | null;
  settings: GraphicsSettings;
  /** ms timestamp of the frame - used for animations. */
  now: number;
  flash: FlashGraphic | null;
  /** Resolved logo images keyed by url. */
  /** Loaded logo image, or null while still loading / unavailable. */
  logo: (url: string | null | undefined, size: number) => unknown;
}

export interface TemplateModule {
  id: string;
  /** Human readable name shown in the dashboard template picker. */
  name: string;
  draw(c: RenderContext): void;
}

/** Registered templates. Add a file in ./templates and list it here. */
export const FONT_STACK = 'DejaVu Sans, Liberation Sans, Arial, sans-serif';
