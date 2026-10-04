import { prisma } from '../db/prisma';
import type { AiSettings, AudioMixSettings, GraphicsSettings, ReplaySettings, StreamOutputSettings, TtsSettings } from '@matchcast/shared';
import {
  aiSettingsSchema,
  audioMixSchema,
  graphicsSettingsSchema,
  replaySettingsSchema,
  streamOutputSchema,
  ttsSettingsSchema,
} from '@matchcast/shared';

/**
 * Settings live in a single `app_settings` table (key -> JSON).
 * Defaults come from the shared zod schemas, so a fresh install is usable
 * before anyone touches the UI.
 */
export const DEFAULT_AI_SETTINGS = aiSettingsSchema.parse({});
export const DEFAULT_TTS_SETTINGS = ttsSettingsSchema.parse({});
export const DEFAULT_AUDIO_SETTINGS = audioMixSchema.parse({});
export const DEFAULT_GRAPHICS_SETTINGS = graphicsSettingsSchema.parse({});
export const DEFAULT_OUTPUT_SETTINGS = streamOutputSchema.parse({});
export const DEFAULT_REPLAY_SETTINGS = replaySettingsSchema.parse({});

export type SettingsKey = 'ai' | 'tts' | 'audio' | 'graphics' | 'output' | 'input' | 'replay';

const VALIDATORS: Record<SettingsKey, (v: unknown) => unknown> = {
  ai: (v) => aiSettingsSchema.parse(v),
  tts: (v) => ttsSettingsSchema.parse(v),
  audio: (v) => audioMixSchema.parse(v),
  graphics: (v) => graphicsSettingsSchema.parse(v),
  output: (v) => streamOutputSchema.parse(v),
  input: (v) => v,
  replay: (v) => replaySettingsSchema.parse(v),
};

const cache = new Map<SettingsKey, unknown>();

async function read<T>(key: SettingsKey, fallback: T): Promise<T> {
  if (cache.has(key)) return cache.get(key) as T;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    if (!row) return fallback;
    return VALIDATORS[key](row.value) as T;
  } catch {
    return fallback;
  }
}

async function write<T>(key: SettingsKey, value: unknown): Promise<T> {
  const parsed = VALIDATORS[key](value) as T;
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: parsed as object },
    update: { value: parsed as object },
  });
  cache.set(key, parsed);
  return parsed;
}

export const settings = {
  ai: () => read<AiSettings>('ai', DEFAULT_AI_SETTINGS),
  setAi: (v: unknown) => write<AiSettings>('ai', { ...DEFAULT_AI_SETTINGS, ...(v as object) }),

  tts: () => read<TtsSettings>('tts', DEFAULT_TTS_SETTINGS),
  setTts: (v: unknown) => write<TtsSettings>('tts', { ...DEFAULT_TTS_SETTINGS, ...(v as object) }),

  audio: () => read<AudioMixSettings>('audio', DEFAULT_AUDIO_SETTINGS),
  setAudio: (v: unknown) => write<AudioMixSettings>('audio', { ...DEFAULT_AUDIO_SETTINGS, ...(v as object) }),

  graphics: () => read<GraphicsSettings>('graphics', DEFAULT_GRAPHICS_SETTINGS),
  setGraphics: (v: unknown) =>
    write<GraphicsSettings>('graphics', { ...DEFAULT_GRAPHICS_SETTINGS, ...(v as object) }),

  output: () => read<StreamOutputSettings>('output', DEFAULT_OUTPUT_SETTINGS),
  setOutput: (v: unknown) => write<StreamOutputSettings>('output', { ...DEFAULT_OUTPUT_SETTINGS, ...(v as object) }),

  input: () => read<{ kind: string; url: string; rightsAttested: boolean; rightsNote?: string | null }>(
    'input',
    { kind: 'demo', url: '', rightsAttested: false, rightsNote: null },
  ),
  setInput: (v: unknown) =>
    write('input', v) as Promise<{ kind: string; url: string; rightsAttested: boolean; rightsNote?: string | null }>,

  replay: () => read<ReplaySettings>('replay', DEFAULT_REPLAY_SETTINGS),
  setReplay: (v: unknown) => write<ReplaySettings>('replay', { ...DEFAULT_REPLAY_SETTINGS, ...(v as object) }),

  invalidate: (key?: SettingsKey) => (key ? cache.delete(key) : cache.clear()),
};
