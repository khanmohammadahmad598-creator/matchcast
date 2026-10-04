import type { AudioMixSettings, StreamOutputSettings } from '@matchcast/shared';
import { RESOLUTION_DIMENSIONS } from '@matchcast/shared';

export interface PipelineArgsInput {
  /** FFmpeg input arguments for the source (from InputManager). */
  inputArgs: string[];
  output: StreamOutputSettings;
  graphics: {
    enabled: boolean;
    fifoPath: string;
    width: number;
    height: number;
    fps: number;
    /** Fallback dynamic text file used when the graphics worker is unavailable. */
    scoreTextFile?: string;
  };
  audio: {
    fifoPath: string;
    mix: AudioMixSettings;
    sampleRate: number;
    channels: number;
  };
  target: string;
  preview?: { enabled: boolean; dir: string; bitrateKbps: number; width: number; height: number };
  replay?: { enabled: boolean; dir: string; segmentSeconds: number; wrap: number; bitrateKbps: number };
  encoding: {
    videoEncoder: string;
    hwAccel: 'off' | 'nvidia' | 'vaapi' | 'qsv';
    preset: string;
    threads?: number;
  };
  extraOutputFlags?: string;
}

/**
 * Builds the complete FFmpeg command line.
 *
 * Graph:
 *   [0] source video/audio  -> scale/fps -> [base]
 *   [1] overlay RGBA fifo   -> [ovl]           (graphics worker)
 *   [base][ovl] overlay     -> [vout]
 *   [0:a] match audio       -> [a_orig]  (ducked by sidechaincompress)
 *   [2] mixed PCM fifo      -> [a_com]   (AI commentary + background bed)
 *   [a_orig][a_com] amix    -> [aout]
 */
export function buildPipelineArgs(o: PipelineArgsInput): string[] {
  const dims = RESOLUTION_DIMENSIONS[o.output.resolution] ?? RESOLUTION_DIMENSIONS['1080p'];
  const gop = Math.max(1, Math.round(o.output.fps * o.output.keyframeIntervalSeconds));
  const { mix } = o.audio;

  const args: string[] = [];

  // ------------------------------------------------------------ global
  args.push('-hide_banner', '-loglevel', 'warning', '-nostdin', '-y');
  // Machine-readable progress on stdout: this is what the watchdog and the
  // live FPS/bitrate readouts consume. Warn loudly if it is ever removed.
  args.push('-progress', 'pipe:1', '-stats_period', '1');
  if (o.encoding.hwAccel === 'vaapi') args.push('-vaapi_device', '/dev/dri/renderD128');

  // ------------------------------------------------------------- input
  args.push(...o.inputArgs);

  // Overlay (transparent RGBA frames rendered by the graphics worker)
  if (o.graphics.enabled) {
    args.push(
      '-f', 'rawvideo',
      '-pixel_format', 'rgba',
      '-video_size', `${o.graphics.width}x${o.graphics.height}`,
      '-framerate', String(o.graphics.fps),
      '-i', o.graphics.fifoPath,
    );
  }

  // Mixed audio produced by our Node PCM mixer (commentary + background bed)
  args.push(
    '-f', 's16le',
    '-ar', String(o.audio.sampleRate),
    '-ac', String(o.audio.channels),
    '-i', o.audio.fifoPath,
  );
  const audioLabel = o.graphics.enabled ? '[2:a]' : '[1:a]';

  // ------------------------------------------------------------ filters
  // Each entry is one complete filter chain; chains are joined with ';'.
  const chains: string[] = [];

  // --- video: normalise the source, then composite the overlay
  const videoSteps = [`fps=${o.output.fps}`, `scale=${dims.width}:${dims.height}:flags=bicubic`, 'setsar=1'];
  if (o.encoding.hwAccel === 'vaapi') videoSteps.push('format=nv12', 'hwupload');
  else videoSteps.push('format=yuv420p');
  chains.push(`[0:v]${videoSteps.join(',')}[base]`);

  if (o.graphics.enabled) {
    chains.push('[1:v]format=rgba[ovl]');
    chains.push('[base][ovl]overlay=0:0:eof_action=pass[vout]');
  } else if (o.graphics.scoreTextFile) {
    // Degraded but still dynamic: a text bug whose file reloads every frame.
    chains.push(
      `[base]drawtext=textfile=${esc(o.graphics.scoreTextFile)}:reload=1:fontcolor=white@0.95:fontsize=${Math.round(
        dims.height / 26,
      )}:box=1:boxcolor=black@0.55:boxborderw=${Math.round(dims.height / 90)}:x=${Math.round(dims.width / 40)}:y=${Math.round(
        dims.height - dims.height / 7,
      )}[vout]`,
    );
  } else {
    chains.push('[base]null[vout]');
  }

  // ---- audio: duck the original feed while commentary is speaking
  const audioFilters: string[] = [];
  audioFilters.push(
    `[0:a]aresample=${o.audio.sampleRate},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${mix.originalVolume}[a_src]`,
  );
  audioFilters.push(
    `${audioLabel}aresample=${o.audio.sampleRate},aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[a_com][a_com_sc]`,
  );
  if (mix.duckingEnabled) {
    audioFilters.push(
      `[a_src][a_com_sc]sidechaincompress=threshold=0.02:ratio=${(1 + mix.duckAmount * 12).toFixed(
        1,
      )}:attack=15:release=350:makeup=1[a_ducked]`,
    );
  } else {
    audioFilters.push('[a_src]anull[a_ducked]');
  }
  audioFilters.push(`[a_com]volume=${mix.commentaryVolume}[a_com_g]`);
  audioFilters.push('[a_ducked][a_com_g]amix=inputs=2:normalize=0:dropout_transition=0[a_mixed]');
  audioFilters.push(
    `[a_mixed]volume=${mix.masterMute ? 0 : 1},alimiter=limit=0.97:level=false,dynaudnorm=f=200:g=3[aout]`,
  );

  // A filter output pad can only be consumed once, so duplicate it when the
  // graph feeds more than one output (RTMP + HLS preview).
  const needsSplit = Boolean(o.preview?.enabled);
  let mainVideo = '[vout]';
  let mainAudio = '[aout]';
  let previewVideo = '[vout]';
  let previewAudio = '[aout]';
  if (needsSplit) {
    chains.push('[vout]split=2[vout_1][vout_2]');
    chains.push('[aout]asplit=2[aout_1][aout_2]');
    mainVideo = '[vout_1]';
    mainAudio = '[aout_1]';
    previewVideo = '[vout_2]';
    previewAudio = '[aout_2]';
  }

  args.push('-filter_complex', [...chains, ...audioFilters].join(';'));

  // ------------------------------------------------------------ output 1
  args.push('-map', mainVideo, '-map', mainAudio);
  args.push('-c:v', o.encoding.videoEncoder);
  if (o.encoding.videoEncoder === 'libx264' || o.encoding.videoEncoder === 'libx265') {
    args.push('-preset', o.encoding.preset, '-tune', 'zerolatency', '-profile:v', 'high', '-pix_fmt', 'yuv420p');
  } else if (o.encoding.videoEncoder === 'h264_nvenc') {
    args.push('-preset', /p[1-7]/.test(o.encoding.preset) ? o.encoding.preset : 'p4', '-pix_fmt', 'yuv420p', '-rc', 'cbr');
  } else if (o.encoding.videoEncoder === 'h264_vaapi') {
    args.push('-qp', '23', '-pix_fmt', 'nv12');
  } else if (o.encoding.videoEncoder === 'h264_qsv') {
    args.push('-pix_fmt', 'nv12');
  }
  args.push(
    '-b:v', `${o.output.videoBitrateKbps}k`,
    '-maxrate', `${Math.round(o.output.videoBitrateKbps * 1.1)}k`,
    '-bufsize', `${o.output.videoBitrateKbps * 2}k`,
    '-g', String(gop),
    '-keyint_min', String(gop),
    '-sc_threshold', '0',
  );
  if (o.encoding.threads) args.push('-threads', String(o.encoding.threads));

  args.push('-c:a', 'aac', '-b:a', `${o.output.audioBitrateKbps}k`, '-ar', '48000', '-ac', '2');
  if (o.extraOutputFlags) args.push(...o.extraOutputFlags.split(/\s+/).filter(Boolean));
  args.push('-flvflags', 'no_duration_filesize', '-f', 'flv', o.target);

  // ------------------------------------------------------------ output 2 (preview HLS)
  if (o.preview?.enabled) {
    args.push(
      '-map', previewVideo, '-map', previewAudio,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-b:v', `${o.preview.bitrateKbps}k`,
      '-s', `${o.preview.width}x${o.preview.height}`,
      '-g', String(o.output.fps * 2),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '64k', '-ar', '48000', '-ac', '2',
      '-f', 'hls',
      '-hls_time', '1',
      '-hls_list_size', '4',
      '-hls_flags', 'delete_segments+append_list+omit_endlist',
      '-hls_segment_filename', `${o.preview.dir}/seg_%03d.ts`,
      `${o.preview.dir}/index.m3u8`,
    );
  }

  // ------------------------------------------------------------ output 3 (replay ring)
  if (o.replay?.enabled) {
    args.push(
      '-map', '0:v', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'ultrafast',
      '-b:v', `${o.replay.bitrateKbps}k`,
      '-s', '1280x720',
      '-g', String(o.output.fps * 2),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '64k',
      '-f', 'segment',
      '-segment_time', String(o.replay.segmentSeconds),
      '-segment_wrap', String(o.replay.wrap),
      '-segment_list_flags', '+live',
      '-reset_timestamps', '1',
      `${o.replay.dir}/seg_%03d.ts`,
    );
  }

  return args;
}

/** Escapes a value for use inside an ffmpeg filter string. */
export function esc(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,');
}
