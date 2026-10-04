import { z } from 'zod';
import { COMMENTARY_STYLES, INPUT_KINDS, LANGUAGES, VIDEO_FPS, VIDEO_RESOLUTIONS, VOICE_GENDERS } from './constants';

/** Accepts both snake_case (public scoring provider contract) and camelCase. */
const dual = <T extends z.ZodTypeAny>(snake: string, camel: string, schema: T) =>
  z.preprocess((raw) => {
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      if (o[snake] !== undefined && o[camel] === undefined) {
        return { ...o, [camel]: o[snake] };
      }
    }
    return raw;
  }, schema);

/* ------------------------------------------------------------------ */
/* Auth                                                               */
/* ------------------------------------------------------------------ */

export const loginSchema = z.object({
  email: z.string().email().max(190),
  password: z.string().min(8).max(200),
});

export const createUserSchema = z.object({
  email: z.string().email().max(190),
  password: z.string().min(10).max(200),
  name: z.string().min(1).max(120),
  role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER']).default('OPERATOR'),
});

/* ------------------------------------------------------------------ */
/* Match setup                                                        */
/* ------------------------------------------------------------------ */

export const teamInputSchema = z.object({
  name: z.string().min(1).max(80),
  shortName: z.string().min(1).max(12),
  logoUrl: z.string().url().optional().nullable(),
  primaryColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional().nullable(),
  secondaryColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional().nullable(),
  players: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        role: z.enum(['BAT', 'BOWL', 'AR', 'WK']).default('BAT'),
        jerseyNumber: z.number().int().min(0).max(999).optional().nullable(),
      }),
    )
    .max(30)
    .default([]),
});

export const createMatchSchema = z.object({
  title: z.string().min(1).max(160),
  tournament: z.string().max(160).optional().nullable(),
  venue: z.string().max(160).optional().nullable(),
  format: z.enum(['T20', 'ODI', 'TEST', 'T10', 'HUNDRED', 'CUSTOM']).default('T20'),
  oversPerInnings: z.number().int().min(1).max(200).optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  teamA: teamInputSchema,
  teamB: teamInputSchema,
});

export const updateMatchSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  tournament: z.string().max(160).optional().nullable(),
  venue: z.string().max(160).optional().nullable(),
  status: z.enum(['SCHEDULED', 'LIVE', 'INNINGS_BREAK', 'COMPLETED', 'ABANDONED', 'PAUSED']).optional(),
  battingTeamId: z.string().optional(),
  bowlingTeamId: z.string().optional(),
});

/* ------------------------------------------------------------------ */
/* Scoring                                                            */
/* ------------------------------------------------------------------ */

/**
 * POST /api/match/update - the authorised live-scoring-provider contract.
 * Kept deliberately forgiving: only the fields that changed need sending.
 */
export const scoreUpdateSchema = z
  .object({
    matchId: z.string().min(1).optional(),
    team: z.string().min(1).max(80).optional(),
    batting_team: z.string().min(1).max(80).optional(),
    runs: z.number().int().min(0).max(2000).optional(),
    wickets: z.number().int().min(0).max(20).optional(),
    /** "18.4" - decimal overs notation. */
    overs: z.string().regex(/^\d{1,3}(\.\d)?$/).optional(),
    striker: z.string().max(80).optional().nullable(),
    non_striker: z.string().max(80).optional().nullable(),
    bowler: z.string().max(80).optional().nullable(),
    striker_runs: z.number().int().min(0).max(1000).optional(),
    striker_balls: z.number().int().min(0).max(1000).optional(),
    bowler_wickets: z.number().int().min(0).max(20).optional(),
    bowler_runs: z.number().int().min(0).max(1000).optional(),
    target: z.number().int().min(0).max(2000).optional().nullable(),
    innings: z.number().int().min(1).max(4).optional(),
    note: z.string().max(240).optional().nullable(),
  })
  .passthrough();

export type ScoreUpdateInput = z.infer<typeof scoreUpdateSchema>;

/** Add a single delivery from the dashboard or an authorised scorer. */
export const ballInputSchema = z.object({
  runs: z.number().int().min(0).max(36).default(0),
  batterRuns: z.number().int().min(0).max(36).optional(),
  extraType: z.enum(['WD', 'NB', 'LB', 'B', 'P']).optional().nullable(),
  isWicket: z.boolean().default(false),
  wicketKind: z
    .enum([
      'BOWLED',
      'CAUGHT',
      'LBW',
      'RUN_OUT',
      'STUMPED',
      'HIT_WICKET',
      'CAUGHT_AND_BOWLED',
      'RETIRED_OUT',
      'OTHER',
    ])
    .optional()
    .nullable(),
  batterOutId: z.string().optional().nullable(),
  newBatterId: z.string().optional().nullable(),
  bowlerId: z.string().optional().nullable(),
  commentary: z.string().max(400).optional().nullable(),
});

export const manualEventSchema = z.object({
  type: z.enum(['FOUR', 'SIX', 'WICKET', 'MILESTONE', 'OVER_END', 'INNINGS_END', 'CUSTOM']),
  headline: z.string().max(240).optional(),
  facts: z.record(z.unknown()).optional(),
});

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

export const aiSettingsSchema = z.object({
  provider: z.enum(['auto', 'openai', 'anthropic', 'gemini', 'rule-based']).default('auto'),
  model: z.string().max(80).optional(),
  enabled: z.boolean().default(true),
  language: z.enum(LANGUAGES).default('hinglish'),
  style: z.enum(COMMENTARY_STYLES).default('professional'),
  cooldownSeconds: z.number().min(0).max(120).default(6),
  minGapSeconds: z.number().min(0).max(120).default(2),
  verbosity: z.number().min(0).max(1).default(0.6),
  speakOnEventTypes: z
    .array(z.enum(['BALL', 'FOUR', 'SIX', 'WICKET', 'MILESTONE', 'OVER_END', 'INNINGS_END', 'MATCH_END', 'MATCH_START', 'CUSTOM']))
    .default(['FOUR', 'SIX', 'WICKET', 'MILESTONE', 'INNINGS_END']),
  maxChars: z.number().int().min(40).max(500).default(180),
  temperature: z.number().min(0).max(2).default(0.8),
  antiRepetitionWindow: z.number().int().min(0).max(100).default(25),
});

export const ttsSettingsSchema = z.object({
  provider: z.enum(['auto', 'openai', 'elevenlabs', 'google', 'mock']).default('auto'),
  enabled: z.boolean().default(true),
  voiceId: z.string().max(120).optional(),
  gender: z.enum(VOICE_GENDERS).default('male'),
  language: z.enum(LANGUAGES).default('hinglish'),
  speed: z.number().min(0.5).max(2).default(1),
  volume: z.number().min(0).max(1.5).default(1),
  pitch: z.number().min(-10).max(10).default(0),
  outputFormat: z.enum(['mp3', 'wav', 'opus']).default('mp3'),
  maxQueue: z.number().int().min(1).max(50).default(8),
  cacheEnabled: z.boolean().default(true),
});

export const audioMixSchema = z.object({
  originalVolume: z.number().min(0).max(1.5).default(1),
  commentaryVolume: z.number().min(0).max(1.5).default(1),
  backgroundVolume: z.number().min(0).max(1.5).default(0.25),
  masterMute: z.boolean().default(false),
  duckingEnabled: z.boolean().default(true),
  duckAmount: z.number().min(0).max(1).default(0.6),
  backgroundTrackPath: z.string().max(500).optional().nullable(),
});

export const graphicsSettingsSchema = z.object({
  templateId: z.string().max(60).default('cricket-modern'),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#00d09c'),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0b1120'),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffffff'),
  fontFamily: z.string().max(80).default('Inter, Arial, sans-serif'),
  showLiveBadge: z.boolean().default(true),
  showSponsorBanner: z.boolean().default(false),
  sponsorText: z.string().max(120).optional().nullable(),
  sponsorLogoUrl: z.string().max(500).optional().nullable(),
  lowerThirdTitle: z.string().max(120).optional().nullable(),
  lowerThirdSubtitle: z.string().max(160).optional().nullable(),
  lowerThirdVisible: z.boolean().default(false),
  introVisible: z.boolean().default(false),
  outroVisible: z.boolean().default(false),
  scoreboardPosition: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).default('bottom-left'),
  opacity: z.number().min(0.2).max(1).default(0.96),
  overlayFps: z.number().int().min(5).max(60).default(15),
  overlayWidth: z.number().int().min(320).max(3840).default(1920),
  overlayHeight: z.number().int().min(180).max(2160).default(1080),
});

export const streamOutputSchema = z.object({
  /** Base RTMP URL (no key). The key is only ever read from the environment. */
  rtmpUrl: z.string().default('rtmps://a.rtmps.youtube.com/live2'),
  resolution: z.enum(VIDEO_RESOLUTIONS).default('1080p'),
  fps: z.union([z.literal(30), z.literal(50), z.literal(60)]).default(30),
  videoBitrateKbps: z.number().int().min(500).max(50000).default(6000),
  audioBitrateKbps: z.number().int().min(32).max(512).default(128),
  preset: z.string().max(40).default('veryfast'),
  keyframeIntervalSeconds: z.number().int().min(1).max(10).default(2),
  extraOutputFlags: z.string().max(400).optional(),
});

const MEDIA_URL_PROTOCOLS = ['rtmp:', 'rtmps:', 'srt:', 'http:', 'https:', 'udp:', 'tcp:', 'file:'];

export const streamInputSchema = z
  .object({
    kind: z.enum(INPUT_KINDS),
    /** Empty is allowed for `demo` (falls back to DEMO_VIDEO) and `device`. */
    url: z.string().max(1000).default(''),
    lowLatency: z.boolean().default(true),
    readTimeoutSeconds: z.number().int().min(1).max(120).default(10),
    /** Operator must confirm they hold the rights to this feed. Enforced server-side. */
    rightsAttested: z.boolean(),
    rightsNote: z.string().max(400).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const fail = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message });

    // Demo mode streams a locally generated clip - no URL required.
    if (value.kind === 'demo' && !value.url) return;
    if (!value.url) {
      if (value.kind === 'device') return; // resolved by the worker (e.g. /dev/video0)
      fail(`A source URL is required for ${value.kind} inputs`);
      return;
    }
    if (value.kind === 'file') {
      const isPath = /^[./~]/.test(value.url) || /^[A-Za-z]:\\/.test(value.url);
      if (!isPath && !value.url.startsWith('file://')) {
        fail('File inputs must be a filesystem path or a file:// URL');
      }
      return;
    }
    try {
      const parsed = new URL(value.url);
      if (!MEDIA_URL_PROTOCOLS.includes(parsed.protocol)) {
        fail(`Unsupported protocol "${parsed.protocol}" - use rtmp://, srt://, http(s):// or file://`);
      }
    } catch {
      fail('Input URL must be a valid URL (rtmp://, srt://, http(s):// or file://)');
    }
  });

export const replaySettingsSchema = z.object({
  enabled: z.boolean().default(false),
  preRollSeconds: z.number().min(1).max(60).default(8),
  postRollSeconds: z.number().min(1).max(60).default(4),
  mode: z.enum(['off', 'cut', 'overlay']).default('off'),
  playbackRate: z.number().min(0.25).max(1).default(0.6),
  maxLatencySeconds: z.number().min(1).max(60).default(6),
  triggerEvents: z
    .array(z.enum(['SIX', 'FOUR', 'WICKET', 'MILESTONE', 'OVER_END', 'INNINGS_END', 'CUSTOM']))
    .default(['SIX', 'WICKET', 'MILESTONE']),
});
