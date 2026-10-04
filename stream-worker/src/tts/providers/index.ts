import type { Language, TtsSettings, VoiceGender } from '@matchcast/shared';
import { config } from '../../core/config';

export interface TtsRequest {
  text: string;
  language: Language;
  gender: VoiceGender;
  voiceId?: string;
  speed: number;
  pitch: number;
  format: 'mp3' | 'wav' | 'opus';
}

export interface TtsResult {
  buffer: Buffer;
  format: 'mp3' | 'wav' | 'opus';
  provider: string;
  voice: string;
}

export interface TtsProvider {
  readonly name: string;
  /** False when the provider has no credentials configured. */
  available(): boolean;
  synthesize(req: TtsRequest): Promise<TtsResult>;
}

/* ------------------------------------------------------------------ */
/* Voice catalogues                                                    */
/* ------------------------------------------------------------------ */

export const OPENAI_VOICES: Record<string, Record<VoiceGender, string>> = {
  hi: { male: 'onyx', female: 'shimmer', neutral: 'alloy' },
  hinglish: { male: 'echo', female: 'nova', neutral: 'alloy' },
  en: { male: 'onyx', female: 'nova', neutral: 'alloy' },
};

export const ELEVENLABS_VOICES: Record<string, Record<VoiceGender, string>> = {
  hi: { male: 'onwK4e9ZLuTAKqWW03F9', female: '21m00Tcm4TlvDq8ikWAM', neutral: 'VR6AewLTigWG4xSOukaG' },
  hinglish: { male: 'onwK4e9ZLuTAKqWW03F9', female: '21m00Tcm4TlvDq8ikWAM', neutral: 'VR6AewLTigWG4xSOukaG' },
  en: { male: 'pNInz6obpgDQGcFmaJgB', female: '21m00Tcm4TlvDq8ikWAM', neutral: 'VR6AewLTigWG4xSOukaG' },
};

export const GOOGLE_VOICES: Record<string, { languageCode: string; male: string; female: string }> = {
  hi: { languageCode: 'hi-IN', male: 'hi-IN-Standard-B', female: 'hi-IN-Standard-A' },
  hinglish: { languageCode: 'en-IN', male: 'en-IN-Standard-B', female: 'en-IN-Standard-A' },
  en: { languageCode: 'en-IN', male: 'en-IN-Standard-B', female: 'en-IN-Standard-A' },
};

export function pickVoice(provider: string, language: Language, gender: VoiceGender, override?: string): string {
  if (override) return override;
  if (provider === 'openai') return OPENAI_VOICES[language]?.[gender] ?? 'alloy';
  if (provider === 'elevenlabs') return ELEVENLABS_VOICES[language]?.[gender] ?? '21m00Tcm4TlvDq8ikWAM';
  if (provider === 'google') {
    const v = GOOGLE_VOICES[language];
    return gender === 'female' ? v?.female ?? 'en-IN-Standard-A' : v?.male ?? 'en-IN-Standard-B';
  }
  return `mock-${language}-${gender}`;
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

export const mockProvider: TtsProvider = {
  name: 'mock',
  available: () => true,
  async synthesize(req) {
    const durationSeconds = Math.min(6, Math.max(0.9, req.text.length / 14 / Math.max(0.5, req.speed)));
    return { buffer: renderToneWav(durationSeconds, req.text), format: 'wav', provider: 'mock', voice: `mock-${req.language}` };
  },
};

/**
 * Offline placeholder speech: an amplitude-modulated tone burst of roughly the
 * duration the real provider would produce. Lets the whole audio path (queue,
 * mixer, ducking, non-overlap) be exercised with zero API spend.
 */
export function renderToneWav(seconds: number, seedText: string): Buffer {
  const sampleRate = 24000;
  const samples = Math.floor(seconds * sampleRate);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let seed = 0;
  for (let i = 0; i < seedText.length; i++) seed = (seed * 31 + seedText.charCodeAt(i)) % 100000;
  const baseFreq = 140 + (seed % 90);

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, t / 0.05) * Math.min(1, (seconds - t) / 0.08);
    // syllable-like modulation
    const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4.2 * t + seed);
    const value = Math.sin(2 * Math.PI * baseFreq * t) * 0.28 * envelope * syllable;
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32767))), 44 + i * 2);
  }
  return buffer;
}

export const openAiProvider: TtsProvider = {
  name: 'openai',
  available: () => Boolean(config.OPENAI_API_KEY),
  async synthesize(req) {
    const voice = pickVoice('openai', req.language, req.gender, req.voiceId);
    const res = await fetch(`${config.OPENAI_BASE_URL}/audio/speech`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
        voice,
        input: req.text,
        response_format: req.format === 'wav' ? 'wav' : 'mp3',
        speed: req.speed,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      format: req.format === 'wav' ? 'wav' : 'mp3',
      provider: 'openai',
      voice,
    };
  },
};

export const elevenLabsProvider: TtsProvider = {
  name: 'elevenlabs',
  available: () => Boolean(config.ELEVENLABS_API_KEY),
  async synthesize(req) {
    const voice = pickVoice('elevenlabs', req.language, req.gender, req.voiceId);
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: 'POST',
      headers: {
        'xi-api-key': config.ELEVENLABS_API_KEY ?? '',
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: req.text,
        model_id: process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
          speed: req.speed,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { buffer: Buffer.from(await res.arrayBuffer()), format: 'mp3', provider: 'elevenlabs', voice };
  },
};

export const googleProvider: TtsProvider = {
  name: 'google',
  available: () => Boolean(config.GOOGLE_TTS_API_KEY),
  async synthesize(req) {
    const meta = GOOGLE_VOICES[req.language] ?? GOOGLE_VOICES.en;
    const name = req.gender === 'female' ? meta.female : meta.male;
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${config.GOOGLE_TTS_API_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: { text: req.text },
        voice: { languageCode: meta.languageCode, name: req.voiceId ?? name },
        audioConfig: {
          audioEncoding: req.format === 'wav' ? 'LINEAR16' : 'MP3',
          speakingRate: req.speed,
          pitch: req.pitch,
          volumeGainDb: 0,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Google TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { audioContent?: string };
    if (!json.audioContent) throw new Error('Google TTS returned no audio');
    return {
      buffer: Buffer.from(json.audioContent, 'base64'),
      format: req.format === 'wav' ? 'wav' : 'mp3',
      provider: 'google',
      voice: req.voiceId ?? name,
    };
  },
};

export const PROVIDERS: Record<string, TtsProvider> = {
  openai: openAiProvider,
  elevenlabs: elevenLabsProvider,
  google: googleProvider,
  mock: mockProvider,
};

export function resolveProvider(settings: TtsSettings): TtsProvider {
  if (settings.provider !== 'auto') {
    const p = PROVIDERS[settings.provider];
    if (p && (p.available() || settings.provider === 'mock')) return p;
  }
  // auto: first provider with credentials, else the offline mock
  for (const name of ['openai', 'elevenlabs', 'google']) {
    const p = PROVIDERS[name];
    if (p?.available()) return p;
  }
  return mockProvider;
}
