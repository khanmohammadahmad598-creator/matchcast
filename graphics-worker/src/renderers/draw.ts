import { FONT_STACK } from './types';

export interface TextStyle {
  size: number;
  weight?: 'normal' | 'bold';
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  alpha?: number;
  letterSpacing?: number;
}

export function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, style: TextStyle): void {
  ctx.save();
  ctx.font = `${style.weight === 'bold' ? 'bold ' : ''}${style.size}px ${FONT_STACK}`;
  ctx.fillStyle = style.color ?? '#ffffff';
  ctx.textAlign = style.align ?? 'left';
  ctx.textBaseline = style.baseline ?? 'alphabetic';
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.fillText(value, x, y);
  ctx.restore();
}

/** Text width with a given style - used for dynamic panel sizing. */
export function measure(ctx: CanvasRenderingContext2D, value: string, size: number, bold = false): number {
  ctx.save();
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT_STACK}`;
  const w = ctx.measureText(value).width;
  ctx.restore();
  return w;
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: string; radius?: number; border?: string; borderWidth?: number; shadow?: boolean } = {},
): void {
  ctx.save();
  if (opts.shadow !== false) {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
  }
  roundRect(ctx, x, y, w, h, opts.radius ?? 16);
  ctx.fillStyle = opts.fill ?? 'rgba(8,12,22,0.88)';
  ctx.fill();
  ctx.restore();

  if (opts.border) {
    ctx.save();
    roundRect(ctx, x, y, w, h, opts.radius ?? 16);
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = opts.borderWidth ?? 2;
    ctx.stroke();
    ctx.restore();
  }
}

/** Pulsing red LIVE badge. */
export function liveBadge(ctx: CanvasRenderingContext2D, x: number, y: number, now: number, scale = 1): void {
  const pulse = 0.65 + 0.35 * Math.abs(Math.sin(now / 700));
  const h = Math.round(34 * scale);
  const w = Math.round(96 * scale);
  ctx.save();
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(220,38,38,0.92)';
  ctx.fill();
  ctx.globalAlpha = pulse;
  ctx.beginPath();
  ctx.arc(x + Math.round(20 * scale), y + h / 2, Math.round(7 * scale), 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  text(ctx, 'LIVE', x + Math.round(34 * scale), y + h / 2, {
    size: Math.round(19 * scale),
    weight: 'bold',
    color: '#ffffff',
    baseline: 'middle',
  });
}

/** Circle chips for the recent deliveries. */
export function ballChips(
  ctx: CanvasRenderingContext2D,
  balls: Array<{ label: string; isFour: boolean; isSix: boolean; isWicket: boolean }>,
  x: number,
  y: number,
  radius: number,
  gap: number,
  accent: string,
): void {
  let cx = x;
  for (const b of balls) {
    const isBoundary = b.isFour || b.isSix;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = b.isWicket ? '#dc2626' : isBoundary ? accent : 'rgba(255,255,255,0.16)';
    ctx.fill();
    ctx.restore();
    text(ctx, b.label, cx, y, {
      size: Math.round(radius * 1.05),
      weight: 'bold',
      color: isBoundary || b.isWicket ? '#0b1120' : '#e2e8f0',
      align: 'center',
      baseline: 'middle',
    });
    cx += radius * 2 + gap;
  }
}

/** Anchor helper so the scoreboard can move to any corner. */
export function anchor(
  position: string,
  width: number,
  height: number,
  panelW: number,
  panelH: number,
  margin = 48,
): { x: number; y: number } {
  switch (position) {
    case 'top-left':
      return { x: margin, y: margin };
    case 'top-right':
      return { x: width - panelW - margin, y: margin };
    case 'bottom-right':
      return { x: width - panelW - margin, y: height - panelH - margin };
    case 'bottom-left':
    default:
      return { x: margin, y: height - panelH - margin };
  }
}

export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const v = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
