import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../core/config';
import { logger } from '../core/logger';
import { resolveFfmpeg } from '../core/config';
import { AUDIO_CHANNELS, AUDIO_SAMPLE_RATE } from '@matchcast/shared';
import type { Language, TtsJob, TtsSettings, VoiceGender } from '@matchcast/shared';
import type { AudioMixer } from '../audio/AudioMixer';
import type { BackendClient } from '../core/backendClient';
import { resolveProvider, type TtsResult } from './providers';

const DEFAULT_SETTINGS: TtsSettings = {
  provider: 'auto',
  enabled: true,
  gender: 'male',
  language: 'hinglish',
  speed: 1,
  volume: 1,
  pitch: 0,
  outputFormat: 'mp3',
  maxQueue: 8,
  cacheEnabled: true,
};

export interface SpeakOptions {
  language?: Language;
  gender?: VoiceGender;
  speed?: number;
  pitch?: number;
  priority?: number;
  commentaryId?: string;
  voiceId?: string;
}

/**
 * Sequential, non-overlapping TTS pipeline:
 *   text -> provider -> audio file (cached) -> PCM -> mixer -> FFmpeg
 *
 * If a provider fails the line is skipped and the broadcast continues silently
 * (requirement: TTS failure must never kill the stream).
 */
export class TtsService {
  private settings: TtsSettings = { ...DEFAULT_SETTINGS };
  private queue: TtsJob[] = [];
  private draining = false;
  private lastFailureAt = 0;
  private failureCount = 0;

  constructor(private mixer: AudioMixer, private backend: BackendClient) {}

  updateSettings(patch: Partial<TtsSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.mixer.setMix({ commentaryVolume: this.settings.volume });
  }

  getSettings(): TtsSettings {
    return this.settings;
  }

  get queueLength(): number {
    return this.queue.length + (this.draining ? 1 : 0);
  }

  get healthy(): boolean {
    return this.failureCount < 5 || Date.now() - this.lastFailureAt > 60_000;
  }

  /** Enqueue a line. High priority lines jump the queue. */
  async speak(text: string, opts: SpeakOptions = {}): Promise<void> {
    if (!this.settings.enabled) {
      logger.debug('tts', 'TTS disabled - skipping line', { text: text.slice(0, 60) });
      return;
    }
    const clean = text.trim();
    if (!clean) return;

    const job: TtsJob = {
      id: crypto.randomUUID(),
      commentaryId: opts.commentaryId,
      text: clean,
      language: opts.language ?? this.settings.language,
      gender: opts.gender ?? this.settings.gender,
      voiceId: opts.voiceId ?? this.settings.voiceId,
      speed: opts.speed ?? this.settings.speed,
      pitch: opts.pitch ?? this.settings.pitch,
      outputFormat: this.settings.outputFormat,
      priority: opts.priority ?? 50,
      createdAt: Date.now(),
      attempts: 0,
    };

    this.queue.push(job);
    this.queue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    while (this.queue.length > Math.max(1, this.settings.maxQueue)) {
      const dropped = this.queue.pop();
      logger.warn('tts', 'TTS queue full - dropped low priority line', { text: dropped?.text.slice(0, 40) });
      if (dropped?.commentaryId) {
        void this.backend.patchCommentary(dropped.commentaryId, { ttsStatus: 'SKIPPED' });
      }
    }
    void this.drain();
  }

  clearQueue(): void {
    this.queue = [];
    this.mixer.clearQueue();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        await this.process(job);
      }
    } finally {
      this.draining = false;
    }
  }

  private async process(job: TtsJob): Promise<void> {
    job.attempts += 1;
    try {
      const pcm = await this.toPcm(job);
      if (!pcm || pcm.length === 0) throw new Error('empty PCM');
      const durationMs = Math.round((pcm.length / (AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * 2)) * 1000);
      logger.info('tts', `Speaking (${job.language}/${job.gender}) ${durationMs}ms: ${job.text.slice(0, 70)}`);
      if (job.commentaryId) {
        void this.backend.patchCommentary(job.commentaryId, { ttsStatus: 'READY', durationMs });
      }
      await this.mixer.playCommentary(pcm, { gain: this.settings.volume, id: job.id });
      if (job.commentaryId) {
        void this.backend.patchCommentary(job.commentaryId, { ttsStatus: 'PLAYED', spoken: true, durationMs });
      }
      this.failureCount = 0;
    } catch (err) {
      this.failureCount += 1;
      this.lastFailureAt = Date.now();
      logger.error('tts', `TTS failed for line (attempt ${job.attempts})`, {
        error: (err as Error).message,
        provider: this.settings.provider,
      });
      if (job.commentaryId) {
        void this.backend.patchCommentary(job.commentaryId, { ttsStatus: 'FAILED' });
      }
      // Retry once for transient network errors, then give up on this line.
      if (job.attempts < 2 && !(err as Error).message.includes('empty PCM')) {
        this.queue.unshift(job);
      }
    }
  }

  /** Provider call + caching + decode to raw PCM. */
  private async toPcm(job: TtsJob): Promise<Buffer> {
    const provider = resolveProvider(this.settings);
    const voiceId = job.voiceId ?? '';
    const key = crypto
      .createHash('sha256')
      .update([provider.name, voiceId, job.language, job.gender, job.speed, job.pitch, job.outputFormat, job.text].join('|'))
      .digest('hex')
      .slice(0, 32);

    const pcmCache = path.join(config.TTS_DIR, `${key}.pcm`);
    if (this.settings.cacheEnabled && fs.existsSync(pcmCache)) {
      return fs.readFileSync(pcmCache);
    }

    const audioCache = path.join(config.TTS_DIR, `${key}.${job.outputFormat}`);
    let result: TtsResult | null = null;

    if (this.settings.cacheEnabled && fs.existsSync(audioCache)) {
      result = {
        buffer: fs.readFileSync(audioCache),
        format: job.outputFormat,
        provider: provider.name,
        voice: voiceId || `${job.language}-${job.gender}`,
      };
    } else {
      result = await provider.synthesize({
        text: job.text,
        language: job.language,
        gender: job.gender,
        voiceId: job.voiceId,
        speed: job.speed,
        pitch: job.pitch,
        format: job.outputFormat,
      });
      fs.writeFileSync(audioCache, result.buffer);
    }

    // Register with the backend so the dashboard can show/play the audio.
    void this.backend.registerTtsAudio({
      commentaryId: job.commentaryId ?? null,
      provider: result.provider,
      voice: result.voice,
      language: job.language,
      text: job.text,
      cacheKey: key,
      filePath: audioCache,
      format: result.format,
      sizeBytes: result.buffer.length,
    });

    const pcm = await decodeToPcm(result.buffer, result.format);
    if (this.settings.cacheEnabled) fs.writeFileSync(pcmCache, pcm);
    return pcm;
  }
}

/** Decodes any provider audio to the raw PCM format our mixer/FFmpeg expect. */
export async function decodeToPcm(buffer: Buffer, format: 'mp3' | 'wav' | 'opus'): Promise<Buffer> {
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (format === 'wav') args.push('-f', 'wav');
  args.push('-i', 'pipe:0', '-f', 's16le', '-ar', String(AUDIO_SAMPLE_RATE), '-ac', String(AUDIO_CHANNELS), 'pipe:1');

  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(resolveFfmpeg(), args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    proc.stdout?.on('data', (c: Buffer) => chunks.push(c));
    proc.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`decode failed (${code}): ${stderr.slice(0, 160)}`));
      resolve(Buffer.concat(chunks));
    });
    proc.stdin?.end(buffer);
  });
}
