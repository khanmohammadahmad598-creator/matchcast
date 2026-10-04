import { logger } from '../core/logger';
import { AntiRepetition } from './antiRepetition';
import { generateLine, resolveAiProvider } from './providers';
import type { BackendClient } from '../core/backendClient';
import type { TtsService } from '../tts/TtsService';
import type { AiSettings, Language, MatchEvent, MatchEventType, ScoreSnapshot } from '@matchcast/shared';

const DEFAULT_SETTINGS: AiSettings = {
  provider: 'auto',
  enabled: true,
  language: 'hinglish',
  style: 'professional',
  cooldownSeconds: 6,
  minGapSeconds: 2,
  verbosity: 0.6,
  speakOnEventTypes: ['FOUR', 'SIX', 'WICKET', 'MILESTONE', 'INNINGS_END'],
  maxChars: 180,
  temperature: 0.8,
  antiRepetitionWindow: 25,
};

/** Seconds of silence after which the engine may offer a state-of-play line. */
const IDLE_SUMMARY_SECONDS = 45;

/**
 * Decides *when* to speak and *what* to say.
 *
 * Grounding rule: the engine only ever receives events derived from real
 * scoring data (see backend matchService) - it cannot invent deliveries,
 * wickets or players.
 */
export class CommentaryEngine {
  private settings: AiSettings = { ...DEFAULT_SETTINGS };
  private anti = new AntiRepetition(DEFAULT_SETTINGS.antiRepetitionWindow);
  private lastSpokeAt = 0;
  private lastEventAt = 0;
  private inFlight = false;

  constructor(
    private tts: TtsService,
    private backend: BackendClient,
    private getSnapshot: () => ScoreSnapshot | null,
  ) {}

  updateSettings(patch: Partial<AiSettings>): void {
    this.settings = { ...this.settings, ...patch };
    if (patch.antiRepetitionWindow !== undefined) this.anti.setWindow(patch.antiRepetitionWindow);
  }

  getSettings(): AiSettings {
    return this.settings;
  }

  get msSinceLastSpoke(): number {
    return Date.now() - this.lastSpokeAt;
  }

  /* ------------------------------------------------------------------ */

  async handleEvent(event: MatchEvent): Promise<void> {
    if (!this.settings.enabled) return;
    if (!this.settings.speakOnEventTypes.includes(event.type)) {
      logger.debug('ai', `Event ${event.type} not in speak list - skipped`);
      return;
    }
    const now = Date.now();
    const gap = (now - this.lastSpokeAt) / 1000;

    // Hard minimum gap between any two spoken lines.
    if (gap < this.settings.minGapSeconds) return;

    // Priority gate: higher verbosity lowers the bar for speaking.
    const threshold = 100 - this.settings.verbosity * 100;
    if (event.priority < threshold) {
      logger.debug('ai', `Event ${event.type} priority ${event.priority} below threshold ${Math.round(threshold)}`);
      return;
    }

    // Big moments get a shorter cooldown; routine balls a longer one.
    const isBigMoment = event.priority >= 90;
    const cooldown = this.settings.cooldownSeconds * (isBigMoment ? 0.4 : 1);
    if (gap < cooldown) {
      logger.debug('ai', `Cooldown active (${gap.toFixed(1)}s < ${cooldown}s) - skipping ${event.type}`);
      return;
    }

    await this.compose(event);
    this.lastEventAt = Date.now();
  }

  /** Optional state-of-play line when nothing has happened for a while. */
  async maybeIdleSummary(): Promise<void> {
    if (!this.settings.enabled) return;
    if (this.settings.verbosity < 0.5) return;
    const idle = (Date.now() - Math.max(this.lastSpokeAt, this.lastEventAt)) / 1000;
    if (idle < IDLE_SUMMARY_SECONDS) return;
    const snapshot = this.getSnapshot();
    if (!snapshot || snapshot.status !== 'LIVE') return;

    const event: MatchEvent = {
      id: `idle-${Date.now()}`,
      type: 'CUSTOM',
      matchId: snapshot.matchId,
      headline: `${snapshot.battingTeam.shortName} ${snapshot.runs}/${snapshot.wickets} after ${snapshot.overs} overs`,
      facts: {
        teamRuns: snapshot.runs,
        teamWickets: snapshot.wickets,
        overs: snapshot.overs,
        requiredRunRate: snapshot.requiredRunRate ?? null,
        target: snapshot.target ?? null,
      },
      priority: 40,
      createdAt: new Date().toISOString(),
    };
    await this.compose(event, true);
    this.lastEventAt = Date.now();
  }

  /** Operator-typed line: speak as-is, no AI generation. */
  async speakManual(text: string, language?: Language): Promise<void> {
    this.lastSpokeAt = Date.now();
    await this.tts.speak(text, { language: language ?? this.settings.language, priority: 95 });
  }

  /* ------------------------------------------------------------------ */

  private async compose(event: MatchEvent, isSummary = false): Promise<void> {
    if (this.inFlight) {
      logger.debug('ai', 'Generation already in flight - dropping event');
      return;
    }
    this.inFlight = true;
    try {
      const snapshot = this.getSnapshot();
      const provider = resolveAiProvider(this.settings.provider);
      const facts = this.factsFor(event, snapshot);

      let line = await generateLine(provider, {
        language: this.settings.language,
        style: this.settings.style,
        event,
        facts,
        maxChars: this.settings.maxChars,
        temperature: this.settings.temperature,
        avoid: this.anti.recent(8),
      });

      if (!line || line.toUpperCase() === 'SKIP') {
        logger.debug('ai', 'Model returned nothing worth saying');
        return;
      }

      // Anti-repetition: try once more with an explicit instruction, else drop.
      if (this.anti.isRepetition(line)) {
        logger.debug('ai', 'Repetition detected - requesting an alternative');
        const retry = await generateLine(provider, {
          language: this.settings.language,
          style: this.settings.style,
          event: { ...event, headline: `${event.headline} (say this differently)` },
          facts,
          maxChars: this.settings.maxChars,
          temperature: Math.min(2, this.settings.temperature + 0.3),
          avoid: this.anti.recent(12),
        });
        if (!retry || this.anti.isRepetition(retry)) {
          logger.info('ai', 'Dropped repetitive commentary line');
          return;
        }
        line = retry;
      }

      this.anti.remember(line);
      this.lastSpokeAt = Date.now();

      logger.info('ai', `Commentary (${this.settings.language}/${this.settings.style}): ${line}`);

      // Persist, then hand to TTS (failure there must not throw).
      const created = await this.backend.saveCommentary({
        matchId: event.matchId,
        text: line,
        language: this.settings.language,
        style: this.settings.style,
        eventType: isSummary ? 'CUSTOM' : event.type,
        provider: provider.name,
      });

      await this.tts.speak(line, {
        language: this.settings.language,
        priority: event.priority,
        commentaryId: created?.item?.id,
      });
    } catch (err) {
      logger.error('ai', 'Commentary generation failed - stream continues', {
        error: (err as Error).message,
        provider: this.settings.provider,
      });
    } finally {
      this.inFlight = false;
    }
  }

  /** Builds the fact sheet handed to the model - only real, current data. */
  private factsFor(event: MatchEvent, snapshot: ScoreSnapshot | null): Record<string, unknown> {
    const base: Record<string, unknown> = {
      batter: event.facts.batter ?? snapshot?.striker?.name ?? null,
      batter_runs: snapshot?.striker?.runs ?? null,
      batter_balls: snapshot?.striker?.balls ?? null,
      bowler: event.facts.bowler ?? snapshot?.bowler?.name ?? null,
      bowler_figures: snapshot?.bowler ? `${snapshot.bowler.wickets}/${snapshot.bowler.runs}` : null,
      batter_out: event.facts.batterOut ?? null,
      dismissal: event.facts.dismissal ?? null,
      runs: event.facts.runs ?? null,
      team: snapshot?.battingTeam?.name ?? null,
      batting_team: snapshot?.battingTeam?.name ?? null,
      bowling_team: snapshot?.bowlingTeam?.name ?? null,
      score: snapshot ? `${snapshot.runs}/${snapshot.wickets}` : null,
      overs: snapshot?.overs ?? null,
      run_rate: snapshot?.runRate ?? null,
      required_run_rate: snapshot?.requiredRunRate ?? null,
      target: snapshot?.target ?? null,
      partnership: snapshot?.partnership ? `${snapshot.partnership.runs} (${snapshot.partnership.balls})` : null,
      milestone: event.facts.milestone ?? null,
      recent_balls: (snapshot?.recentBalls ?? []).slice(-6).map((b) => b.label).join(' '),
      is_four: Boolean(event.facts.isFour),
      is_six: Boolean(event.facts.isSix),
      is_wicket: Boolean(event.facts.isWicket),
      free_hit: snapshot?.freeHit ?? false,
    };
    // Drop empty values so the model is never tempted to fill them in.
    return Object.fromEntries(Object.entries(base).filter(([, v]) => v !== null && v !== undefined && v !== ''));
  }
}

export const COMMENTARY_EVENT_TYPES: MatchEventType[] = [
  'BALL',
  'FOUR',
  'SIX',
  'WICKET',
  'MILESTONE',
  'OVER_END',
  'INNINGS_END',
  'MATCH_START',
  'CUSTOM',
];
