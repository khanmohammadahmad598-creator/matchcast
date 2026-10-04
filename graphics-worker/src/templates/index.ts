import { text, withAlpha } from '../renderers/draw';
import type { RenderContext, TemplateModule } from '../renderers/types';
import { cricketModern } from './cricketModern';
import { cricketClassic } from './cricketClassic';
import { cricketMinimal } from './cricketMinimal';

export const TEMPLATES: Record<string, TemplateModule> = {
  [cricketModern.id]: cricketModern,
  [cricketClassic.id]: cricketClassic,
  [cricketMinimal.id]: cricketMinimal,
};

export function resolveTemplate(id: string): TemplateModule {
  return TEMPLATES[id] ?? cricketModern;
}

export { cricketModern, cricketClassic, cricketMinimal };

/**
 * Elements that appear regardless of the scoreboard template:
 * tournament title, sponsor banner, lower third, flash graphics, intro/outro.
 */
export function drawShared(c: RenderContext): void {
  const { ctx, settings, snapshot, width, height } = c;
  const s = height / 1080;

  // ------------------------------------------------------ tournament title
  if (snapshot?.tournament) {
    text(ctx, snapshot.tournament.toUpperCase(), 48 * s, 72 * s, {
      size: 28 * s,
      weight: 'bold',
      color: withAlpha(settings.textColor, 0.9),
    });
    ctx.save();
    ctx.fillStyle = settings.accentColor;
    ctx.fillRect(48 * s, 86 * s, 120 * s, 4 * s);
    ctx.restore();
  }

  // -------------------------------------------------------- sponsor banner
  if (settings.showSponsorBanner && (settings.sponsorText || settings.sponsorLogoUrl)) {
    const w = 320 * s;
    const h = 70 * s;
    const x = width - w - 48 * s;
    const y = height - h - 40 * s;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    const logo = c.logo(settings.sponsorLogoUrl, Math.round(h - 20 * s));
    if (logo) {
      try {
        ctx.drawImage(logo as never, x + 16 * s, y + 10 * s, h - 20 * s, h - 20 * s);
      } catch {
        /* ignore image errors */
      }
      if (settings.sponsorText) {
        text(ctx, settings.sponsorText, x + h + 4 * s, y + h / 2, {
          size: 22 * s,
          color: withAlpha(settings.textColor, 0.9),
          baseline: 'middle',
        });
      }
    } else if (settings.sponsorText) {
      text(ctx, settings.sponsorText, x + 20 * s, y + h / 2, {
        size: 24 * s,
        color: withAlpha(settings.textColor, 0.92),
        baseline: 'middle',
      });
    }
  }

  // ------------------------------------------------------------ lower third
  if (settings.lowerThirdVisible && settings.lowerThirdTitle) {
    const w = 560 * s;
    const h = 96 * s;
    const x = 48 * s;
    const y = height - h - 300 * s;
    ctx.save();
    ctx.fillStyle = withAlpha(settings.backgroundColor, 0.92);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = settings.accentColor;
    ctx.fillRect(x, y, 8 * s, h);
    ctx.restore();
    text(ctx, settings.lowerThirdTitle, x + 28 * s, y + (settings.lowerThirdSubtitle ? 40 * s : h / 2 + 2 * s), {
      size: 32 * s,
      weight: 'bold',
      color: settings.textColor,
      baseline: 'middle',
    });
    if (settings.lowerThirdSubtitle) {
      text(ctx, settings.lowerThirdSubtitle, x + 28 * s, y + 70 * s, {
        size: 24 * s,
        color: withAlpha(settings.textColor, 0.8),
        baseline: 'middle',
      });
    }
  }

  // ------------------------------------------------------------ flash graphic
  if (c.flash && c.flash.until > c.now) {
    const remaining = c.flash.until - c.now;
    const alpha = Math.min(1, remaining / 400);
    const w = 900 * s;
    const h = 190 * s;
    const x = (width - w) / 2;
    const y = height * 0.28;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = withAlpha(settings.backgroundColor, 0.94);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = settings.accentColor;
    ctx.fillRect(x, y, 10 * s, h);
    ctx.restore();
    text(ctx, c.flash.title.toUpperCase(), x + 44 * s, y + (c.flash.subtitle ? 76 * s : h / 2), {
      size: 58 * s,
      weight: 'bold',
      color: settings.textColor,
      baseline: 'middle',
      alpha,
    });
    if (c.flash.subtitle) {
      text(ctx, c.flash.subtitle, x + 44 * s, y + 136 * s, {
        size: 30 * s,
        color: withAlpha(settings.textColor, 0.85),
        baseline: 'middle',
        alpha,
      });
    }
  }

  // ------------------------------------------------------------------ intro
  if (settings.introVisible && snapshot) {
    ctx.save();
    ctx.fillStyle = withAlpha(settings.backgroundColor, 0.9);
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    const cx = width / 2;
    text(ctx, snapshot.title.toUpperCase(), cx, height * 0.42, {
      size: 72 * s,
      weight: 'bold',
      color: settings.textColor,
      align: 'center',
      baseline: 'middle',
    });
    text(ctx, `${snapshot.battingTeam.name} vs ${snapshot.bowlingTeam.name}`, cx, height * 0.55, {
      size: 44 * s,
      color: settings.accentColor,
      align: 'center',
      baseline: 'middle',
    });
    if (snapshot.venue || snapshot.tournament) {
      text(ctx, [snapshot.tournament, snapshot.venue].filter(Boolean).join('  •  '), cx, height * 0.63, {
        size: 28 * s,
        color: withAlpha(settings.textColor, 0.8),
        align: 'center',
        baseline: 'middle',
      });
    }
  }

  // ------------------------------------------------------------------ outro
  if (settings.outroVisible) {
    ctx.save();
    ctx.fillStyle = withAlpha(settings.backgroundColor, 0.92);
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    text(ctx, 'THANKS FOR WATCHING', width / 2, height * 0.46, {
      size: 68 * s,
      weight: 'bold',
      color: settings.textColor,
      align: 'center',
      baseline: 'middle',
    });
    if (snapshot) {
      text(ctx, `${snapshot.battingTeam.shortName} ${snapshot.runs}/${snapshot.wickets} (${snapshot.overs})`, width / 2, height * 0.56, {
        size: 36 * s,
        color: settings.accentColor,
        align: 'center',
        baseline: 'middle',
      });
    }
  }
}
