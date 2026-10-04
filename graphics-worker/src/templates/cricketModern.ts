import { ballChips, liveBadge, measure, panel, roundRect, text, withAlpha } from '../renderers/draw';
import type { RenderContext, TemplateModule } from '../renderers/types';

/**
 * "Cricket Modern": translucent glass scoreboard with LIVE badge, target/RRR,
 * current batsmen, bowler figures, partnership and the last six deliveries.
 */
export const cricketModern: TemplateModule = {
  name: 'Cricket Modern',
  id: 'cricket-modern',
  draw(c: RenderContext) {
    const { ctx, snapshot, settings } = c;
    if (!snapshot) return;
    const s = c.height / 1080;
    const accent = settings.accentColor;

    const w = 1010 * s;
    const h = 226 * s;
    const { x, y } = anchorPos(settings.scoreboardPosition, c.width, c.height, w, h, 48 * s);

    // ------------------------------------------------------------ panel
    panel(ctx, x, y, w, h, {
      fill: withAlpha(settings.backgroundColor, settings.opacity),
      radius: 22 * s,
      border: withAlpha(accent, 0.35),
      borderWidth: 2 * s,
    });

    // accent strip
    ctx.save();
    roundRect(ctx, x, y + 26 * s, 8 * s, h - 52 * s, 4 * s);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.restore();

    const padX = x + 34 * s;
    let cursorY = y + 62 * s;

    // --------------------------------------------------------- row 1
    text(ctx, snapshot.battingTeam.shortName.toUpperCase(), padX, cursorY, {
      size: 40 * s,
      weight: 'bold',
      color: settings.textColor,
    });
    const teamNameWidth = measure(ctx, snapshot.battingTeam.shortName.toUpperCase(), 40 * s, true);

    const score = `${snapshot.runs}/${snapshot.wickets}`;
    text(ctx, score, padX + teamNameWidth + 26 * s, cursorY, { size: 58 * s, weight: 'bold', color: accent });
    const scoreWidth = measure(ctx, score, 58 * s, true);

    text(ctx, `(${snapshot.overs})`, padX + teamNameWidth + scoreWidth + 44 * s, cursorY, {
      size: 32 * s,
      color: withAlpha(settings.textColor, 0.75),
    });

    // right side of row 1: target / RRR / CRR
    const rightX = x + w - 34 * s;
    if (snapshot.target) {
      text(ctx, `TARGET ${snapshot.target}`, rightX, cursorY - 16 * s, {
        size: 26 * s,
        weight: 'bold',
        color: withAlpha(settings.textColor, 0.85),
        align: 'right',
      });
      text(
        ctx,
        `RRR ${snapshot.requiredRunRate ? snapshot.requiredRunRate.toFixed(2) : '-'}`,
        rightX,
        cursorY + 16 * s,
        { size: 26 * s, color: accent, align: 'right' },
      );
    } else {
      text(ctx, `CRR ${snapshot.runRate.toFixed(2)}`, rightX, cursorY, {
        size: 28 * s,
        weight: 'bold',
        color: accent,
        align: 'right',
      });
    }

    // --------------------------------------------------------- row 2
    cursorY = y + 128 * s;
    const striker = snapshot.striker;
    const nonStriker = snapshot.nonStriker;
    const bowler = snapshot.bowler;

    if (striker) {
      text(ctx, `${striker.name}  ${striker.runs}(${striker.balls})`, padX, cursorY, {
        size: 30 * s,
        weight: 'bold',
        color: settings.textColor,
      });
    }
    if (nonStriker) {
      const wStriker = measure(ctx, `${striker?.name ?? ''}  ${striker?.runs ?? 0}(${striker?.balls ?? 0})`, 30 * s, true);
      text(ctx, `${nonStriker.name}  ${nonStriker.runs}(${nonStriker.balls})`, padX + wStriker + 46 * s, cursorY, {
        size: 30 * s,
        color: withAlpha(settings.textColor, 0.8),
      });
    }
    if (bowler) {
      text(ctx, `${bowler.name}  ${bowler.wickets}/${bowler.runs}`, rightX, cursorY, {
        size: 28 * s,
        color: withAlpha(settings.textColor, 0.9),
        align: 'right',
      });
    }

    // --------------------------------------------------------- row 3
    cursorY = y + 184 * s;
    text(
      ctx,
      `PARTNERSHIP ${snapshot.partnership.runs} (${snapshot.partnership.balls})   •   EXTRAS ${snapshot.extras.total}`,
      padX,
      cursorY,
      { size: 24 * s, color: withAlpha(settings.textColor, 0.7) },
    );

    // recent balls, right aligned above the bottom row
    const balls = snapshot.recentBalls.slice(-6);
    if (balls.length) {
      const radius = 20 * s;
      const gap = 10 * s;
      const totalWidth = balls.length * (radius * 2 + gap) - gap;
      ballChips(ctx, balls, rightX - totalWidth + radius, y + 178 * s, radius, gap, accent);
    }

    if (settings.showLiveBadge) {
      liveBadge(ctx, x + w - 130 * s, y - 30 * s, c.now, s);
    }
  },
};

export function anchorPos(
  position: string,
  width: number,
  height: number,
  panelW: number,
  panelH: number,
  margin: number,
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
