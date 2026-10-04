import { liveBadge, measure, panel, text, withAlpha } from '../renderers/draw';
import type { RenderContext, TemplateModule } from '../renderers/types';
import { anchorPos } from './cricketModern';

/**
 * "Cricket Minimal": single-line score bug. Ideal for a clean look or when the
 * broadcast already has its own lower third.
 */
export const cricketMinimal: TemplateModule = {
  name: 'Cricket Minimal',
  id: 'cricket-minimal',
  draw(c: RenderContext) {
    const { ctx, snapshot, settings } = c;
    if (!snapshot) return;
    const s = c.height / 1080;
    const accent = settings.accentColor;

    const label = `${snapshot.battingTeam.shortName} ${snapshot.runs}/${snapshot.wickets} (${snapshot.overs})`;
    const extra = snapshot.target ? `  •  need ${Math.max(0, snapshot.target - snapshot.runs + 1)}` : '';
    const full = label + extra;

    const textSize = 34 * s;
    const padding = 22 * s;
    const w = measure(ctx, full, textSize, true) + padding * 2;
    const h = 68 * s;
    const { x, y } = anchorPos(settings.scoreboardPosition, c.width, c.height, w, h, 36 * s);

    panel(ctx, x, y, w, h, {
      fill: withAlpha(settings.backgroundColor, Math.min(1, settings.opacity + 0.04)),
      radius: 34 * s,
      border: withAlpha(accent, 0.4),
      borderWidth: 1.5 * s,
    });

    text(ctx, full, x + padding, y + h / 2 + 1 * s, {
      size: textSize,
      weight: 'bold',
      color: settings.textColor,
      baseline: 'middle',
    });

    if (settings.showLiveBadge) {
      liveBadge(ctx, x + w + 16 * s, y + (h - 34 * s) / 2, c.now, s);
    }
  },
};
