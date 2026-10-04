import { describe, it, expect } from 'vitest';

import { buildPipelineArgs } from '../ffmpegArgs';
import { maskTarget, redactStreamKey } from '../../core/config';
import type { AudioMixSettings, GraphicsSettings, StreamOutputSettings } from '@matchcast/shared';
import type { PipelineArgsInput } from '../ffmpegArgs';

const output: StreamOutputSettings = {
  rtmpUrl: 'rtmps://a.rtmps.youtube.com/live2',
  resolution: '720p',
  fps: 30,
  videoBitrateKbps: 2500,
  audioBitrateKbps: 128,
  preset: 'veryfast',
  keyframeIntervalSeconds: 2,
};

const graphics: GraphicsSettings = {
  templateId: 'cricket-modern',
  accentColor: '#00d09c',
  backgroundColor: '#0b1120',
  textColor: '#ffffff',
  fontFamily: 'Inter, Arial, sans-serif',
  showLiveBadge: true,
  showSponsorBanner: false,
  lowerThirdVisible: false,
  introVisible: false,
  outroVisible: false,
  scoreboardPosition: 'bottom-left',
  opacity: 0.96,
  overlayFps: 15,
  overlayWidth: 1280,
  overlayHeight: 720,
};

const mix: AudioMixSettings = {
  originalVolume: 1,
  commentaryVolume: 1,
  backgroundVolume: 0.25,
  masterMute: false,
  duckingEnabled: true,
  duckAmount: 0.6,
  backgroundTrackPath: null,
};

const encoding: PipelineArgsInput['encoding'] = { videoEncoder: 'libx264', hwAccel: 'off', preset: 'veryfast' };

function build(overrides: Partial<Parameters<typeof buildPipelineArgs>[0]> = {}) {
  return buildPipelineArgs({
    inputArgs: ['-re', '-i', 'input.mp4'],
    output,
    graphics: { enabled: true, fifoPath: '/tmp/graphics.rgba', width: 1280, height: 720, fps: 15 },
    audio: { fifoPath: '/tmp/commentary.pcm', mix, sampleRate: 48000, channels: 2 },
    target: 'rtmps://a.rtmps.youtube.com/live2/abcdefghijklmnop',
    preview: { enabled: false, dir: '/tmp/prev', bitrateKbps: 900, width: 854, height: 480 },
    replay: { enabled: false, dir: '/tmp/replay', segmentSeconds: 5, wrap: 24, bitrateKbps: 1500 },
    encoding,
    ...overrides,
  });
}

describe('ffmpeg argument builder', () => {
  it('emits machine readable progress on stdout (watchdog + live stats)', () => {
    const args = build();
    expect(args).toContain('-progress');
    expect(args[args.indexOf('-progress') + 1]).toBe('pipe:1');
  });

  it('redacts the stream key from anything that gets logged', () => {
    const args = build();
    // ffmpeg itself MUST receive the full target - it is the only way to
    // connect. What must never happen is the key reaching a log or the API.
    expect(redactStreamKey(args.join(' '))).not.toContain('abcdefghijklmnop');
    expect(redactStreamKey(args.join(' '))).toContain('<redacted-stream-key>');
    const key = process.env.YOUTUBE_STREAM_KEY;
    if (key) expect(maskTarget()).not.toContain(key);
    expect(maskTarget()).not.toMatch(/[A-Za-z0-9]{16,}$/);
  });

  it('joins filter chains with ";" so ffmpeg can parse them', () => {
    const args = build();
    const filter = args[args.indexOf('-filter_complex') + 1] as string;
    expect(filter).toContain('[0:v]fps=30,scale=1280:720');
    // Every chain is separated by ';' - a missing separator is a classic
    // ffmpeg "Option not found" failure at startup.
    expect(filter.split(';').length).toBeGreaterThan(3);
    expect(filter).not.toMatch(/setsar=1format/);
    expect(filter).toContain('setsar=1,format=yuv420p');
  });

  it('duplicates the filtered output when the HLS preview is enabled', () => {
    const args = build({ preview: { enabled: true, dir: '/tmp/prev', bitrateKbps: 900, width: 854, height: 480 } });
    const filter = args[args.indexOf('-filter_complex') + 1] as string;
    // A filter output pad can only be consumed once -> split/asplit.
    expect(filter).toContain('split=2');
    expect(filter).toContain('asplit=2');
    expect(args.filter((a) => a === '[vout_1]')).toHaveLength(1);
    expect(args.filter((a) => a === '[vout_2]')).toHaveLength(1);
    expect(args).toContain('/tmp/prev/index.m3u8');
  });

  it('omits the graphics overlay when no renderer is attached', () => {
    const args = build({ graphics: { enabled: false, fifoPath: '', width: 1280, height: 720, fps: 15 } });
    const filter = args[args.indexOf('-filter_complex') + 1] as string;
    expect(filter).not.toContain('overlay=');
  });

  it('ducks the original audio only when ducking is enabled', () => {
    const withDucking = build();
    expect((withDucking[withDucking.indexOf('-filter_complex') + 1] as string)).toContain('sidechaincompress');
    const noDucking = build({
      audio: {
        fifoPath: '/tmp/commentary.pcm',
        mix: { ...mix, duckingEnabled: false },
        sampleRate: 48000,
        channels: 2,
      },
    });
    expect((noDucking[noDucking.indexOf('-filter_complex') + 1] as string)).not.toContain('sidechaincompress');
  });

  it('mutes everything when the master mute is on', () => {
    const args = build({
      audio: {
        fifoPath: '/tmp/commentary.pcm',
        mix: { ...mix, masterMute: true },
        sampleRate: 48000,
        channels: 2,
      },
    });
    const filter = args[args.indexOf('-filter_complex') + 1] as string;
    expect(filter).toMatch(/volume=0(\D|$)/);
  });

  it('uses the hardware encoder when one is available', () => {
    const args = build({ encoding: { videoEncoder: 'h264_nvenc', hwAccel: 'nvidia', preset: 'p4' } });
    expect(args).toContain('h264_nvenc');
    expect(args).not.toContain('libx264');
  });

  it('targets low latency on the RTMP output', () => {
    const args = build();
    expect(args).toContain('-tune');
    expect(args).toContain('zerolatency');
    expect(args).toContain('-flvflags');
    expect(args).toContain('no_duration_filesize');
  });

  it('adds the replay segmenter without touching the main graph', () => {
    const args = build({
      replay: { enabled: true, dir: '/tmp/replay', segmentSeconds: 5, wrap: 24, bitrateKbps: 1500 },
    });
    expect(args.join(' ')).toContain('/tmp/replay/seg_');
    expect(args).toContain('-f');
    expect(args).toContain('segment');
  });
});
