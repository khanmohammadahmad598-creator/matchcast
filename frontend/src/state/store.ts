import { create } from 'zustand';
import { api, endpoints, getToken, setToken } from '../lib/api';
import { getSocket, resetSocket, subscribe } from '../lib/socket';
import type {
  AiSettings,
  AudioMixSettings,
  CommentaryItem,
  GraphicsSettings,
  GraphicsTemplate,
  LogEntry,
  MatchEvent,
  ReplaySettings,
  ScoreSnapshot,
  StreamOutputSettings,
  StreamStatus,
  SystemStats,
  TtsSettings,
  WorkerStatus,
} from '@matchcast/shared';
import { EV } from '@matchcast/shared';

export interface MatchSummary {
  id: string;
  title: string;
  status: string;
  format: string;
  teamA: { id: string; name: string; shortName: string };
  teamB: { id: string; name: string; shortName: string };
}

interface AppState {
  // auth
  token: string | null;
  user: { id: string; email: string; role: string; name?: string } | null;
  booted: boolean;

  // live data
  matches: MatchSummary[];
  matchId: string | null;
  score: ScoreSnapshot | null;
  events: MatchEvent[];
  commentary: CommentaryItem[];
  stream: StreamStatus | null;
  stats: SystemStats | null;
  logs: LogEntry[];
  workers: WorkerStatus[];
  connected: boolean;

  // settings
  ai: AiSettings | null;
  tts: TtsSettings | null;
  audio: AudioMixSettings | null;
  graphics: GraphicsSettings | null;
  output: StreamOutputSettings | null;
  replay: ReplaySettings | null;
  templates: GraphicsTemplate[];
  input: { kind: string; url: string; rightsAttested: boolean; rightsNote?: string | null } | null;

  // actions
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  selectMatch: (id: string) => Promise<void>;
  refreshMatches: () => Promise<void>;
  pushLog: (entry: LogEntry) => void;
  patch: <K extends keyof AppState>(key: K, value: AppState[K]) => void;
}

export const useStore = create<AppState>((set, get) => ({
  token: getToken(),
  user: null,
  booted: false,

  matches: [],
  matchId: null,
  score: null,
  events: [],
  commentary: [],
  stream: null,
  stats: null,
  logs: [],
  workers: [],
  connected: false,

  ai: null,
  tts: null,
  audio: null,
  graphics: null,
  output: null,
  replay: null,
  templates: [],
  input: null,

  async login(email, password) {
    const res = await api<{ token: string; user: { id: string; email: string; role: string; name?: string } }>(
      endpoints.login,
      { method: 'POST', body: { email, password } },
    );
    setToken(res.token);
    set({ token: res.token, user: res.user });
    resetSocket();
    await get().bootstrap();
  },

  async logout() {
    try {
      await api(endpoints.logout, { method: 'POST' });
    } catch {
      /* ignore */
    }
    setToken(null);
    resetSocket();
    set({ token: null, user: null, booted: false });
  },

  async bootstrap() {
    const [me, matches, commentary, ai, tts, audio, graphics, output, replay, templates, streamStatus, workers, input] =
      await Promise.all([
        api<{ user: AppState['user'] }>(endpoints.me).catch(() => null),
        api<{ matches: MatchSummary[] }>(endpoints.matches).catch(() => ({ matches: [] as MatchSummary[] })),
        api<{ items: CommentaryItem[] }>(endpoints.commentaryHistory).catch(() => ({ items: [] as CommentaryItem[] })),
        api<{ settings: AiSettings }>(endpoints.commentarySettings).catch(() => null),
        api<{ settings: TtsSettings }>(endpoints.ttsSettings).catch(() => null),
        api<{ audio: AudioMixSettings }>(endpoints.streamAudio).catch(() => null),
        api<{ settings: GraphicsSettings }>(endpoints.graphicsSettings).catch(() => null),
        api<{ output: StreamOutputSettings }>(endpoints.streamOutput).catch(() => null),
        api<{ replay: ReplaySettings }>(endpoints.streamReplay).catch(() => null),
        api<{ templates: GraphicsTemplate[] }>(endpoints.graphicsTemplates).catch(() => ({ templates: [] as GraphicsTemplate[] })),
        api<{ status: StreamStatus; workers: WorkerStatus[] }>(endpoints.streamStatus).catch(() => null),
        api<{ status: StreamStatus; workers: WorkerStatus[] }>(endpoints.streamStatus).catch(() => null),
        api<{ input: AppState['input'] }>(endpoints.streamInput).catch(() => null),
      ]);

    const firstLive = matches.matches.find((m) => m.status === 'LIVE') ?? matches.matches[0] ?? null;
    set({
      user: me?.user ?? null,
      matches: matches.matches,
      commentary: commentary.items,
      ai: ai?.settings ?? null,
      tts: tts?.settings ?? null,
      audio: audio?.audio ?? null,
      graphics: graphics?.settings ?? null,
      output: output?.output ?? null,
      replay: replay?.replay ?? null,
      templates: templates.templates,
      stream: streamStatus?.status ?? null,
      workers: workers?.workers ?? [],
      input: input?.input ?? null,
      matchId: firstLive?.id ?? null,
      booted: true,
    });

    if (firstLive) await get().selectMatch(firstLive.id);

    // ---- realtime wiring (idempotent: re-subscribing replaces listeners)
    const socket = getSocket();
    socket.off(EV.SCORE_UPDATE);
    socket.off(EV.MATCH_EVENT);
    socket.off(EV.COMMENTARY_NEW);
    socket.off(EV.STREAM_STATUS);
    socket.off(EV.SYSTEM_STATS);
    socket.off(EV.LOG);
    socket.off(EV.GRAPHICS_UPDATE);
    socket.off(EV.WORKER_STATUS);

    socket.on('connect', () => set({ connected: true }));
    socket.on('disconnect', () => set({ connected: false }));
    set({ connected: socket.connected });

    socket.on(EV.SCORE_UPDATE, (s: ScoreSnapshot) => set({ score: s }));
    socket.on(EV.MATCH_EVENT, (e: MatchEvent) => set({ events: [e, ...get().events].slice(0, 50) }));
    socket.on(EV.COMMENTARY_NEW, (c: CommentaryItem) => set({ commentary: [...get().commentary, c].slice(-200) }));
    socket.on(EV.STREAM_STATUS, (s: StreamStatus) => set({ stream: s }));
    socket.on(EV.SYSTEM_STATS, (s: SystemStats) => set({ stats: s }));
    socket.on(EV.GRAPHICS_UPDATE, (g: GraphicsSettings) => set({ graphics: g }));
    socket.on(EV.WORKER_STATUS, (w: WorkerStatus) => {
      const others = get().workers.filter((x) => x.name !== w.name);
      set({ workers: [...others, w] });
    });
    socket.on(EV.LOG, (entry: LogEntry) => {
      set({ logs: [entry, ...get().logs].slice(0, 300) });
    });
  },

  async selectMatch(id) {
    set({ matchId: id });
    const [snapshot] = await Promise.all([
      api<{ snapshot: ScoreSnapshot | null }>(endpoints.matchState(id)).catch(() => ({ snapshot: null })),
    ]);
    set({ score: snapshot.snapshot ?? null });
  },

  async refreshMatches() {
    const res = await api<{ matches: MatchSummary[] }>(endpoints.matches).catch(() => ({ matches: [] as MatchSummary[] }));
    set({ matches: res.matches });
  },

  pushLog(entry) {
    set({ logs: [entry, ...get().logs].slice(0, 300) });
  },

  patch(key, value) {
    set({ [key]: value } as Partial<AppState>);
  },
}));

export { subscribe };
