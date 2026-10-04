import type {
  AudioMixSettings,
  CommentaryItem,
  GraphicsSettings,
  InputStatus,
  LogEntry,
  MatchEvent,
  ReplayClip,
  ReplaySettings,
  ScoreSnapshot,
  StreamStatus,
  SystemStats,
  TtsSettings,
  WorkerStatus,
} from './types';

/** Socket.IO event names. Single source of truth for backend + workers + frontend. */
export const EV = {
  /** backend -> dashboards + workers */
  SCORE_UPDATE: 'score:update',
  MATCH_UPDATE: 'match:update',
  MATCH_EVENT: 'match:event',
  COMMENTARY_NEW: 'commentary:new',
  GRAPHICS_UPDATE: 'graphics:update',
  SETTINGS_UPDATE: 'settings:update',
  STREAM_STATUS: 'stream:status',
  INPUT_STATUS: 'input:status',
  SYSTEM_STATS: 'system:stats',
  LOG: 'log:new',
  REPLAY_CLIP: 'replay:clip',
  /** worker -> backend */
  WORKER_HELLO: 'worker:hello',
  WORKER_STATUS: 'worker:status',
  WORKER_LOG: 'worker:log',
  /** backend -> worker (commands) */
  WORKER_COMMAND: 'worker:command',
} as const;

export type WorkerName = 'stream-worker' | 'graphics-worker' | 'broadcast';

export type WorkerCommand =
  | { type: 'stream:start'; payload?: Record<string, never> }
  | { type: 'stream:stop'; payload?: Record<string, never> }
  | { type: 'stream:restart'; payload?: { reason?: string } }
  | { type: 'input:set'; payload: { kind: string; url: string; rightsAttested: boolean; rightsNote?: string | null } }
  | { type: 'output:reconnect'; payload?: Record<string, never> }
  | { type: 'audio:mix'; payload: Partial<AudioMixSettings> }
  | { type: 'tts:settings'; payload: Partial<TtsSettings> }
  | { type: 'tts:speak'; payload: { text: string; language?: string; priority?: number; commentaryId?: string } }
  | { type: 'tts:clear'; payload?: Record<string, never> }
  | { type: 'commentary:trigger'; payload: { event: MatchEvent } }
  | { type: 'replay:settings'; payload: Partial<ReplaySettings> }
  | { type: 'replay:capture'; payload: { event: MatchEvent } }
  | { type: 'graphics:settings'; payload: Partial<GraphicsSettings> }
  | { type: 'graphics:flash'; payload: { title: string; subtitle?: string; ms?: number } }
  | { type: 'ping'; payload?: Record<string, never> };

export interface ServerToClientEvents {
  [EV.SCORE_UPDATE]: (p: ScoreSnapshot) => void;
  [EV.MATCH_UPDATE]: (p: { matchId: string; status: string }) => void;
  [EV.MATCH_EVENT]: (p: MatchEvent) => void;
  [EV.COMMENTARY_NEW]: (p: CommentaryItem) => void;
  [EV.GRAPHICS_UPDATE]: (p: GraphicsSettings) => void;
  [EV.SETTINGS_UPDATE]: (p: Record<string, unknown>) => void;
  [EV.STREAM_STATUS]: (p: StreamStatus) => void;
  [EV.INPUT_STATUS]: (p: InputStatus) => void;
  [EV.SYSTEM_STATS]: (p: SystemStats) => void;
  [EV.LOG]: (p: LogEntry) => void;
  [EV.REPLAY_CLIP]: (p: ReplayClip) => void;
  [EV.WORKER_STATUS]: (p: WorkerStatus) => void;
  [EV.WORKER_COMMAND]: (p: WorkerCommand) => void;
}

export interface ClientToServerEvents {
  [EV.WORKER_HELLO]: (p: { name: WorkerName; token: string }, ack: (r: { ok: boolean; error?: string }) => void) => void;
  [EV.WORKER_STATUS]: (p: WorkerStatus) => void;
  [EV.WORKER_LOG]: (p: LogEntry) => void;
  subscribe: (p: { rooms: string[] }) => void;
}

export const ROOMS = {
  DASHBOARD: 'dashboard',
  STREAM_WORKER: 'worker:stream',
  GRAPHICS_WORKER: 'worker:graphics',
  ADMINS: 'admins',
} as const;
