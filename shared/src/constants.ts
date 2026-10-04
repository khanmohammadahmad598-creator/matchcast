/** Global, dependency-free constants shared by every service. */

export const APP_NAME = 'MatchCast';

/** Supported commentary languages. */
export const LANGUAGES = ['hi', 'hinglish', 'en'] as const;
/** Supported commentary personalities. */
export const COMMENTARY_STYLES = ['professional', 'excited', 'calm', 'fast', 'expert'] as const;
/** Supported TTS voice genders (provider dependent). */
export const VOICE_GENDERS = ['male', 'female', 'neutral'] as const;

/**
 * Authorised input source kinds.
 * NOTE (compliance): MatchCast only ingests video the operator owns or is
 * licensed to broadcast. See docs/COMPLIANCE.md.
 */
export const INPUT_KINDS = ['rtmp', 'srt', 'hls', 'file', 'device', 'demo'] as const;

export const VIDEO_RESOLUTIONS = ['720p', '1080p'] as const;
export const VIDEO_FPS = [30, 50, 60] as const;
export const VIDEO_CODECS = ['h264', 'hevc'] as const;
/** Hardware encoders tried in order when HW acceleration is enabled. */
export const HW_ENCODERS: Record<'nvidia' | 'vaapi' | 'qsv' | 'videotoolbox' | 'amf', string> = {
  nvidia: 'h264_nvenc',
  vaapi: 'h264_vaapi',
  qsv: 'h264_qsv',
  videotoolbox: 'h264_videotoolbox',
  amf: 'h264_amf',
};

/** Default ABR-ish bitrate ladder (kbps) per resolution/fps, used before manual override. */
export const DEFAULT_BITRATES: Record<string, Record<number, number>> = {
  '720p': { 30: 3000, 50: 4000, 60: 4500 },
  '1080p': { 30: 5000, 50: 6500, 60: 8000 },
};

export const RESOLUTION_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

export const DEFAULT_AUDIO_BITRATE_KBPS = 128;
export const AUDIO_SAMPLE_RATE = 48000;
export const AUDIO_CHANNELS = 2;
/** Bytes per second of the raw PCM pipe that feeds FFmpeg (48kHz / s16le / stereo). */
export const PCM_BYTES_PER_SECOND = AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * 2;

/** Events that are considered "major" and therefore worth a replay/commentary spike. */
export const MAJOR_EVENTS = ['SIX', 'FOUR', 'WICKET', 'MILESTONE', 'FIFTY', 'HUNDRED', 'FIVE_WICKETS'] as const;

export const MAX_COMMENTARY_CHARS = 220;
export const SECRET_ENV_KEYS = [
  'YOUTUBE_STREAM_KEY',
  'JWT_SECRET',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'ELEVENLABS_API_KEY',
  'GOOGLE_TTS_API_KEY',
  'AZURE_TTS_KEY',
  'SCORING_API_KEY',
  'WORKER_TOKEN',
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
];
