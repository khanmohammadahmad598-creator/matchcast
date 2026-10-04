import { ballChips, liveBadge, panel, text, withAlpha } from '../renderers/draw';
import type { RenderContext, TemplateModule } from '../renderers/types';
import { anchorPos } from './cricketModern';

/**
 * "Cricket Classic": full-width broadcast bar with solid team-colour blocks -
 * maximum legibility, the traditional look.
 */
export const cricketClassic: TemplateModule = {
  name: 'Cricket Classic',
  id: 'cricket-classic',
  draw(c: RenderContext) {
    const { ctx, snapshot, settings } = c;
    if (!snapshot) return;
    const s = c.height / 1080;
    const accent = settings.accentColor;

    const w = 1180 * s;
    const h = 150 * s;
    const { x, y } = anchorPos(settings.scoreboardPosition, c.width, c.height, w, h, 40 * s);

    panel(ctx, x, y, w, h, {
      fill: withAlpha(settings.backgroundColor, Math.min(1, settings.opacity + 0.04)),
      radius: 10 * s,
      border: 'rgba(255,255,255,0.14)',
      borderWidth: 1.5 * s,
    });

    // Batting team colour block
    const teamColor = snapshot.battingTeam.primaryColor ?? accent;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, 14 * s, h);
    ctx.fillStyle = teamColor;
    ctx.fill();
    ctx.restore();

    const padX = x + 36 * s;
    text(ctx, snapshot.battingTeam.shortName.toUpperCase(), padX, y + 62 * s, {
      size: 34 * s,
      weight: 'bold',
      color: settings.textColor,
    });

    const score = `${snapshot.runs}-${snapshot.wickets}`;
    text(ctx, score, padX, y + 122 * s, { size: 54 * s, weight: 'bold', color: accent });

    text(ctx, `OV ${snapshot.overs}`, padX + 210 * s, y + 62 * s, {
      size: 28 * s,
      color: withAlpha(settings.textColor, 0.8),
    });
    text(ctx, `CRR ${snapshot.runRate.toFixed(2)}`, padX + 210 * s, y + 100 * s, {
      size: 26 * s,
      color: withAlpha(settings.textColor, 0.7),
    });
    if (snapshot.target) {
      text(ctx, `RRR ${snapshot.requiredRunRate?.toFixed(2) ?? '-'}`, padX + 210 * s, y + 134 * s, {
        size: 26 * s,
        color: accent,
      });
    }

    // Striker / non-striker column
    const col2 = padX + 430 * s;
    if (snapshot.striker) {
      text(ctx, `${snapshot.striker.name} ${snapshot.striker.runs}(${snapshot.striker.balls})`, col2, y + 62 * s, {
        size: 28 * s,
        weight: 'bold',
        color: settings.textColor,
      });
    }
    if (snapshot.nonStriker) {
      text(
        ctx,
        `${snapshot.nonStriker.name} ${snapshot.nonStriker.runs}(${snapshot.nonStriker.balls})`,
        col2,
        y + 100 * s,
        { size: 26 * s, color: withAlpha(settings.textColor, 0.8) },
      );
    }
    if (snapshot.bowler) {
      text(ctx, `${snapshot.bowler.name} ${snapshot.bowler.wickets}/${snapshot.bowler.runs}`, col2, y + 134 * s, {
        size: 26 * s,
        color: withAlpha(settings.textColor, 0.75),
      });
    }

    // Recent deliveries on the right
    const balls = snapshot.recentBalls.slice(-5);
    if (balls.length) {
      ballChips(ctx, balls, x + w - 40 * s - (5 * (18 * s * 2 + 8 * s) - 8 * s) + 18 * s, y + h / 2, 18 * s, 8 * s, accent);
    }

    if (settings.showLiveBadge) {
      liveBadge(ctx, x + w - 130 * s, y - 32 * s, c.now, s);
    }
  },
};
