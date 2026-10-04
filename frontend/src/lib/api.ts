const TOKEN_KEY = 'matchcast_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Base URL of the API. Empty string = same origin (vite proxy / nginx). */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  if (res.status === 401) {
    setToken(null);
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'Session expired');
  }

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const message =
      (data as { error?: string })?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

export const endpoints = {
  login: '/api/auth/login',
  me: '/api/auth/me',
  logout: '/api/auth/logout',
  matches: '/api/matches',
  match: (id: string) => `/api/matches/${id}`,
  matchPlayers: (id: string) => `/api/matches/${id}/players`,
  scoreUpdate: '/api/match/update',
  matchState: (id?: string) => (id ? `/api/match/${id}/state` : '/api/match/state'),
  start: (id: string) => `/api/match/${id}/start`,
  innings: (id: string) => `/api/match/${id}/innings`,
  ball: (id: string) => `/api/match/${id}/ball`,
  wicket: (id: string) => `/api/match/${id}/wicket`,
  boundary: (id: string) => `/api/match/${id}/boundary`,
  undo: (id: string) => `/api/match/${id}/undo`,
  batters: (id: string) => `/api/match/${id}/batters`,
  target: (id: string) => `/api/match/${id}/target`,
  commentaryHistory: '/api/commentary/history',
  commentarySettings: '/api/commentary/settings',
  commentarySpeak: '/api/commentary/speak',
  commentaryTrigger: '/api/commentary/trigger',
  ttsSettings: '/api/tts/settings',
  ttsVoices: '/api/tts/voices',
  ttsSpeak: '/api/tts/speak',
  ttsClear: '/api/tts/clear',
  graphicsSettings: '/api/graphics/settings',
  graphicsTemplates: '/api/graphics/templates',
  graphicsUpload: '/api/graphics/upload',
  graphicsFlash: '/api/graphics/flash',
  graphicsApply: (id: string) => `/api/graphics/templates/${id}/apply`,
  streamStatus: '/api/stream/status',
  streamStart: '/api/stream/start',
  streamStop: '/api/stream/stop',
  streamRestart: '/api/stream/restart',
  streamReconnect: '/api/stream/reconnect',
  streamInput: '/api/stream/input',
  streamOutput: '/api/stream/output',
  streamAudio: '/api/stream/audio',
  streamReplay: '/api/stream/replay',
  streamSessions: '/api/stream/sessions',
  systemStats: '/api/system/stats',
  systemLogs: '/api/system/logs',
  health: '/api/system/health',
};
