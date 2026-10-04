import type {
  COMMENTARY_STYLES,
  INPUT_KINDS,
  LANGUAGES,
  VIDEO_FPS,
  VIDEO_RESOLUTIONS,
  VOICE_GENDERS,
} from './constants';

export type Language = (typeof LANGUAGES)[number];
export type CommentaryStyle = (typeof COMMENTARY_STYLES)[number];
export type VoiceGender = (typeof VOICE_GENDERS)[number];
export type InputKind = (typeof INPUT_KINDS)[number];
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];
export type VideoFps = (typeof VIDEO_FPS)[number];

export type ID = string;

/* ------------------------------------------------------------------ */
/* Match domain                                                        */
/* ------------------------------------------------------------------ */

export type MatchFormat = 'T20' | 'ODI' | 'TEST' | 'T10' | 'HUNDRED' | 'CUSTOM';
export type MatchStatus = 'SCHEDULED' | 'LIVE' | 'INNINGS_BREAK' | 'COMPLETED' | 'ABANDONED' | 'PAUSED';
export type ExtraType = 'WD' | 'NB' | 'LB' | 'B' | 'P';
export type DismissalKind =
  | 'BOWLED'
  | 'CAUGHT'
  | 'LBW'
  | 'RUN_OUT'
  | 'STUMPED'
  | 'HIT_WICKET'
  | 'CAUGHT_AND_BOWLED'
  | 'RETIRED_OUT'
  | 'OTHER';

export interface TeamRef {
  id: ID;
  name: string;
  shortName: string;
  /** Data-URI or HTTP(S) URL of the team logo, drawn by the graphics renderer. */
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
}

export interface BatterSnapshot {
  id: ID;
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  strikeRate: number;
  onStrike: boolean;
}

export interface BowlerSnapshot {
  id: ID;
  name: string;
  overs: number;
  maidens: number;
  runs: number;
  wickets: number;
  economy: number;
}

export interface BallSnapshot {
  id: ID;
  /** Completed overs before this ball, e.g. 18 -> "18.x". */
  over: number;
  /** 1..6 (or 7+ for extras) - ball number within the over as bowled. */
  ballInOver: number;
  /** Label shown on the scoreboard: '.', '1', '4', '6', 'W', 'wd', 'nb' ... */
  label: string;
  runs: number;
  /** Runs credited to the batter (excludes wides). */
  batterRuns: number;
  isExtra: boolean;
  extraType?: ExtraType | null;
  isWicket: boolean;
  isFour: boolean;
  isSix: boolean;
  isLegal: boolean;
  commentary?: string | null;
  createdAt: string;
}

export interface Partnership {
  runs: number;
  balls: number;
}

export interface ExtrasBreakdown {
  wides: number;
  noBalls: number;
  byes: number;
  legByes: number;
  penalties: number;
  total: number;
}

/** Full, immutable-in-time view of the score. Flows to graphics + commentary. */
export interface ScoreSnapshot {
  matchId: ID;
  inningsId: ID;
  inningsNumber: number;
  status: MatchStatus;
  format: MatchFormat;
  title: string;
  tournament?: string | null;
  venue?: string | null;
  battingTeam: TeamRef;
  bowlingTeam: TeamRef;
  runs: number;
  wickets: number;
  /** Overs as a decimal, e.g. 18.4 */
  overs: number;
  legalBalls: number;
  /** First-innings score when chasing, undefined while setting the target. */
  target?: number | null;
  maxOvers?: number | null;
  runRate: number;
  requiredRunRate?: number | null;
  runsRequired?: number | null;
  ballsRemaining?: number | null;
  projectedScore?: number | null;
  striker?: BatterSnapshot | null;
  nonStriker?: BatterSnapshot | null;
  bowler?: BowlerSnapshot | null;
  partnership: Partnership;
  extras: ExtrasBreakdown;
  freeHit: boolean;
  /** Most recent first. */
  recentBalls: BallSnapshot[];
  /** Monotonic counter - graphics/commentary ignore stale snapshots using it. */
  version: number;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Events derived from scoring data                                    */
/* ------------------------------------------------------------------ */

export type MatchEventType =
  | 'BALL'
  | 'FOUR'
  | 'SIX'
  | 'WICKET'
  | 'MILESTONE'
  | 'OVER_END'
  | 'INNINGS_END'
  | 'MATCH_END'
  | 'MATCH_START'
  | 'CUSTOM';

/** A normalised, commentary-ready description of "what just happened". */
export interface MatchEvent {
  id: string;
  type: MatchEventType;
  matchId: ID;
  /** Human readable one-liner, e.g. "Sharma to Kohli - SIX over long-on". */
  headline: string;
  /** Structured facts the AI engine may use (and nothing else). */
  facts: {
    runs?: number;
    isFour?: boolean;
    isSix?: boolean;
    isWicket?: boolean;
    isExtra?: boolean;
    extraType?: ExtraType | null;
    dismissal?: DismissalKind | null;
    batterOut?: string | null;
    batter?: string | null;
    bowler?: string | null;
    milestone?: 'FIFTY' | 'HUNDRED' | 'FIVE_WICKETS' | null;
    teamRuns?: number;
    teamWickets?: number;
    overs?: number;
    requiredRunRate?: number | null;
    target?: number | null;
    partnership?: Partnership;
    recentBalls?: string[];
  };
  /** Higher = more likely to interrupt and speak. */
  priority: number;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Commentary + TTS                                                    */
/* ------------------------------------------------------------------ */

export interface CommentaryItem {
  id: ID;
  matchId: ID;
  language: Language;
  style: CommentaryStyle;
  text: string;
  /** Event that triggered it (null for manual/operator commentary). */
  eventType?: MatchEventType | null;
  provider: string;
  spoken: boolean;
  ttsStatus: 'PENDING' | 'SYNTHESISING' | 'READY' | 'PLAYED' | 'FAILED' | 'SKIPPED';
  audioUrl?: string | null;
  durationMs?: number | null;
  createdAt: string;
}

export interface AiSettings {
  provider: 'auto' | 'openai' | 'anthropic' | 'gemini' | 'rule-based';
  model?: string;
  enabled: boolean;
  language: Language;
  style: CommentaryStyle;
  /** Seconds to wait after speaking before another line may be spoken. */
  cooldownSeconds: number;
  /** Minimum seconds between any two commentary lines. */
  minGapSeconds: number;
  /** 0..1 - how chatty the engine is (higher = speaks on more events). */
  verbosity: number;
  /** Only speak on these event types (plus manual lines). */
  speakOnEventTypes: MatchEventType[];
  maxChars: number;
  temperature: number;
  /** Remember recent lines and refuse to repeat them. */
  antiRepetitionWindow: number;
}

export interface TtsSettings {
  provider: 'auto' | 'openai' | 'elevenlabs' | 'google' | 'mock';
  enabled: boolean;
  voiceId?: string;
  gender: VoiceGender;
  language: Language;
  /** 0.5 .. 2.0 */
  speed: number;
  /** 0.0 .. 1.5 */
  volume: number;
  /** -10 .. 10 semitones (provider dependent) */
  pitch: number;
  /** Output container/codec requested from the provider. */
  outputFormat: 'mp3' | 'wav' | 'opus';
  /** Max items waiting to be spoken; older ones are dropped. */
  maxQueue: number;
  /** Cache synthesized audio so repeated lines are instant and free. */
  cacheEnabled: boolean;
}

export interface TtsJob {
  id: string;
  commentaryId?: ID;
  text: string;
  language: Language;
  voiceId?: string;
  gender: VoiceGender;
  speed: number;
  pitch: number;
  outputFormat: 'mp3' | 'wav' | 'opus';
  /** priority 0..100, higher wins */
  priority: number;
  createdAt: number;
  attempts: number;
}

export interface AudioMixSettings {
  /** 0..1.5 gain applied to the original match feed audio. */
  originalVolume: number;
  /** 0..1.5 gain applied to AI commentary. */
  commentaryVolume: number;
  /** 0..1.5 gain applied to the optional background bed. */
  backgroundVolume: number;
  /** Mute everything (useful for rights-restricted audio). */
  masterMute: boolean;
  /** Duck the match audio while commentary is speaking. */
  duckingEnabled: boolean;
  /** How far the match audio drops, 0..1 (1 = full duck). */
  duckAmount: number;
  /** Path/URL of an operator-supplied, licensed background bed (may be empty). */
  backgroundTrackPath?: string | null;
}

/* ------------------------------------------------------------------ */
/* Streaming                                                           */
/* ------------------------------------------------------------------ */

export interface StreamOutputSettings {
  /** Full RTMP URL including stream key, resolved from env at runtime. */
  rtmpUrl: string;
  resolution: VideoResolution;
  fps: VideoFps;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  /** x264 / nvenc preset-ish string. */
  preset: string;
  keyframeIntervalSeconds: number;
  /** Extra raw ffmpeg output flags for advanced operators. */
  extraOutputFlags?: string;
}

export interface StreamInputSettings {
  kind: InputKind;
  /** URL, file path or device identifier. */
  url: string;
  /** Reopen the input with low latency probe sizes. */
  lowLatency: boolean;
  /** Seconds before an input with no data is considered dead. */
  readTimeoutSeconds: number;
  /** Operator attestation that they are licensed to rebroadcast this feed. */
  rightsAttested: boolean;
  /** Optional note recorded in the audit log. */
  rightsNote?: string | null;
}

export type ConnectionState = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'ERROR' | 'DISCONNECTED';

export interface InputStatus {
  kind: InputKind;
  state: ConnectionState;
  url: string;
  bitrateKbps: number;
  fps: number;
  /** Frames dropped at the input since start. */
  droppedFrames: number;
  /** ffmpeg-reported speed, e.g. 1.02 */
  speed?: number;
  reconnectCount: number;
  lastError?: string | null;
  lastConnectedAt?: string | null;
  /** Resolution reported by the source. */
  width?: number;
  height?: number;
  updatedAt: string;
}

export interface OutputStatus {
  target: string;
  state: ConnectionState;
  bitrateKbps: number;
  fps: number;
  reconnectCount: number;
  lastError?: string | null;
  startedAt?: string | null;
  bytesSent?: number;
  updatedAt: string;
}

export interface StreamStatus {
  running: boolean;
  state: ConnectionState;
  pipelineGeneration: number;
  uptimeSeconds: number;
  input: InputStatus;
  output: OutputStatus;
  /** Live ffmpeg stats. */
  fps: number;
  bitrateKbps: number;
  speed: number;
  droppedFrames: number;
  cpuPercent: number;
  lastError?: string | null;
  updatedAt: string;
}

export interface ReplaySettings {
  enabled: boolean;
  /** Seconds of action kept before the event. */
  preRollSeconds: number;
  /** Seconds kept after the event. */
  postRollSeconds: number;
  /** How a replay reaches the live output. */
  mode: 'off' | 'cut' | 'overlay';
  /** 0.25 .. 1.0 - playback rate (0.5 = half speed). */
  playbackRate: number;
  /** Hard safety guard: never insert a replay if pipeline latency budget is exceeded. */
  maxLatencySeconds: number;
  /** Events that trigger a capture. */
  triggerEvents: MatchEventType[];
}

export interface ReplayClip {
  id: string;
  matchId: ID;
  eventType: MatchEventType;
  filePath: string;
  durationSeconds: number;
  createdAt: string;
  inserted: boolean;
}

/* ------------------------------------------------------------------ */
/* Graphics                                                            */
/* ------------------------------------------------------------------ */

export interface GraphicsSettings {
  templateId: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  showLiveBadge: boolean;
  showSponsorBanner: boolean;
  sponsorText?: string | null;
  sponsorLogoUrl?: string | null;
  lowerThirdTitle?: string | null;
  lowerThirdSubtitle?: string | null;
  lowerThirdVisible: boolean;
  introVisible: boolean;
  outroVisible: boolean;
  /** Scoreboard anchor position on the 16:9 canvas. */
  scoreboardPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity: number;
  /** Frames per second the overlay renderer produces. */
  overlayFps: number;
  /** Overlay canvas size - must match the stream output resolution. */
  overlayWidth: number;
  overlayHeight: number;
}

export interface GraphicsTemplate {
  id: string;
  name: string;
  description: string;
  previewColor: string;
  config: Partial<GraphicsSettings>;
}

/* ------------------------------------------------------------------ */
/* System                                                             */
/* ------------------------------------------------------------------ */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
export type LogSource = 'backend' | 'stream-worker' | 'graphics-worker' | 'ffmpeg' | 'ai' | 'tts' | 'youtube' | 'scoring' | 'system';

export interface LogEntry {
  id?: ID;
  level: LogLevel;
  source: LogSource;
  message: string;
  meta?: Record<string, unknown> | null;
  createdAt: string;
}

export interface SystemStats {
  cpuPercent: number;
  loadAverage: number[];
  memTotalMb: number;
  memUsedMb: number;
  memPercent: number;
  gpu?: {
    name: string;
    utilPercent: number;
    memUsedMb: number;
    memTotalMb: number;
  } | null;
  diskFreeMb: number;
  uptimeSeconds: number;
  nodeHeapUsedMb: number;
  createdAt: string;
}

export interface WorkerStatus {
  name: 'stream-worker' | 'graphics-worker';
  online: boolean;
  pid?: number;
  uptimeSeconds: number;
  /** Free-form per-worker details. */
  details?: Record<string, unknown>;
  updatedAt: string;
}
