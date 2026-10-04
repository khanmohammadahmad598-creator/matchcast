import { useState } from 'react';
import { api, endpoints } from '../lib/api';
import { useStore } from '../state/store';
import { Badge, Card, Empty, Field, Select, Slider, Stat, StatusDot, Toggle } from '../components/ui';
import type { ReplaySettings, StreamOutputSettings } from '@matchcast/shared';

const INPUT_KINDS = [
  { value: 'demo', label: 'Demo video (looped local file)' },
  { value: 'file', label: 'Local video file' },
  { value: 'rtmp', label: 'RTMP input' },
  { value: 'srt', label: 'SRT input' },
  { value: 'hls', label: 'HLS input' },
  { value: 'device', label: 'Capture device / camera' },
] as const;

export function Streaming() {
  const { stream, input, output, audio, replay, workers, patch } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rights, setRights] = useState(false);
  const [url, setUrl] = useState(input?.url ?? '');
  const [kind, setKind] = useState<string>(input?.kind ?? 'demo');
  const [note, setNote] = useState(input?.rightsNote ?? '');

  async function act(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const streamWorkerOnline = workers.some((w) => w.name === 'stream-worker' && w.online);
  const live = Boolean(stream?.running);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Streaming</h1>
          <p className="text-sm text-slate-500">Input source, YouTube RTMP output, audio mix and failover</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary"
            disabled={busy !== null || live}
            onClick={() => void act('start', () => api(endpoints.streamStart, { method: 'POST' }))}
          >
            {busy === 'start' ? 'Starting…' : 'Start stream'}
          </button>
          <button className="btn-danger" disabled={busy !== null || !live} onClick={() => void act('stop', () => api(endpoints.streamStop, { method: 'POST' }))}>
            Stop
          </button>
          <button className="btn-ghost" disabled={busy !== null} onClick={() => void act('restart', () => api(endpoints.streamRestart, { method: 'POST' }))}>
            Restart pipeline
          </button>
          <button className="btn-ghost" disabled={busy !== null} onClick={() => void act('reconnect', () => api(endpoints.streamReconnect, { method: 'POST' }))}>
            Reconnect output
          </button>
        </div>
      </div>

      {!streamWorkerOnline && (
        <p className="rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
          stream-worker is offline. Start it with <code className="font-mono">npm run dev:stream</code> to go live.
        </p>
      )}
      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Input source" subtitle="Only feeds you own or are licensed to broadcast">
          <div className="space-y-3">
            <Select label="Source type" value={kind} options={[...INPUT_KINDS]} onChange={setKind} />
            <Field
              label="Source URL or path"
              value={url}
              onChange={setUrl}
              placeholder={kind === 'demo' ? 'Leave blank to use demo-assets/demo-match.mp4' : 'rtmp://host/live/stream'}
              hint={kind === 'device' ? 'Examples: /dev/video0, :0 (X11), default (alsa/pulse)' : undefined}
            />
            <label className="flex items-start gap-2 rounded-lg border border-white/5 bg-ink-700/40 p-3">
              <input type="checkbox" className="mt-0.5 accent-[#00d09c]" checked={rights} onChange={(e) => setRights(e.target.checked)} />
              <span className="text-xs text-slate-300">
                I confirm I own this feed or hold a broadcast licence for it. This attestation is recorded in the
                compliance audit log.
              </span>
            </label>
            <Field label="Rights note (optional)" value={note} onChange={setNote} placeholder="e.g. Club agreement 2026-04-01" />
            <button
              className="btn-ghost"
              disabled={busy !== null}
              onClick={() =>
                void act('input', async () => {
                  await api(endpoints.streamInput, { method: 'PUT', body: { kind, url, rightsAttested: rights, rightsNote: note } });
                  patch('input', { kind, url, rightsAttested: rights, rightsNote: note });
                })
              }
            >
              {busy === 'input' ? 'Saving…' : 'Save input source'}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Stat label="Input state" value={stream?.input.state ?? 'IDLE'} hint={stream?.input.lastError ?? undefined} />
            <Stat
              label="Input bitrate"
              value={stream?.input.bitrateKbps ? `${Math.round(stream.input.bitrateKbps)} kbps` : '—'}
              hint={`${stream?.input.reconnectCount ?? 0} reconnects`}
            />
          </div>
        </Card>

        <Card title="YouTube output" subtitle="The stream key is read from the server environment and never shown here">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <StatusDot state={stream?.output.state ?? 'IDLE'} />
              <span className="text-slate-300">{stream?.output.state ?? 'IDLE'}</span>
              {stream?.output.lastError && <Badge tone="bad">{stream.output.lastError}</Badge>}
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">RTMP endpoint</dt>
                <dd className="font-mono text-slate-200">{output?.rtmpUrl ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Stream key</dt>
                <dd className="font-mono text-slate-200">•••••••• (server-side)</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Pipeline generation</dt>
                <dd className="font-mono text-slate-200">{stream?.pipelineGeneration ?? 0}</dd>
              </div>
            </dl>

            {output && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Resolution"
                  value={output.resolution}
                  options={[
                    { value: '720p', label: '1280×720' },
                    { value: '1080p', label: '1920×1080' },
                  ]}
                  onChange={(v) => {
                    const next = { ...output, resolution: v } as StreamOutputSettings;
                    patch('output', next);
                    void api(endpoints.streamOutput, { method: 'PUT', body: next });
                  }}
                />
                <Select
                  label="Frame rate"
                  value={String(output.fps)}
                  options={[
                    { value: '30', label: '30 fps' },
                    { value: '50', label: '50 fps' },
                    { value: '60', label: '60 fps' },
                  ]}
                  onChange={(v) => {
                    const next = { ...output, fps: Number(v) as 30 | 50 | 60 } as StreamOutputSettings;
                    patch('output', next);
                    void api(endpoints.streamOutput, { method: 'PUT', body: next });
                  }}
                />
              </div>
            )}

            {output && (
              <>
                <Slider
                  label="Video bitrate"
                  value={output.videoBitrateKbps}
                  min={800}
                  max={20000}
                  step={100}
                  onChange={(v) => {
                    const next = { ...output, videoBitrateKbps: v } as StreamOutputSettings;
                    patch('output', next);
                    void api(endpoints.streamOutput, { method: 'PUT', body: next });
                  }}
                  format={(v) => `${(v / 1000).toFixed(1)} Mbps`}
                />
                <Slider
                  label="Audio bitrate"
                  value={output.audioBitrateKbps}
                  min={64}
                  max={320}
                  step={32}
                  onChange={(v) => {
                    const next = { ...output, audioBitrateKbps: v } as StreamOutputSettings;
                    patch('output', next);
                    void api(endpoints.streamOutput, { method: 'PUT', body: next });
                  }}
                  format={(v) => `${v} kbps`}
                />
              </>
            )}
            <p className="text-xs text-slate-500">
              Resolution, FPS and bitrate changes apply the next time the pipeline starts (or after a restart).
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Audio mixing" subtitle="Original feed + AI commentary + background bed">
          {audio ? (
            <div className="space-y-4">
              <Slider
                label="Original match audio"
                value={audio.originalVolume}
                min={0}
                max={1.5}
                step={0.05}
                onChange={(v) => {
                  const next = { ...audio, originalVolume: v };
                  patch('audio', next);
                  void api(endpoints.streamAudio, { method: 'PUT', body: next });
                }}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <Slider
                label="AI commentary"
                value={audio.commentaryVolume}
                min={0}
                max={1.5}
                step={0.05}
                onChange={(v) => {
                  const next = { ...audio, commentaryVolume: v };
                  patch('audio', next);
                  void api(endpoints.streamAudio, { method: 'PUT', body: next });
                }}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <Slider
                label="Background bed"
                value={audio.backgroundVolume}
                min={0}
                max={1.5}
                step={0.05}
                onChange={(v) => {
                  const next = { ...audio, backgroundVolume: v };
                  patch('audio', next);
                  void api(endpoints.streamAudio, { method: 'PUT', body: next });
                }}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <Field
                label="Background track path (licensed audio only)"
                value={audio.backgroundTrackPath ?? ''}
                onChange={(v) => {
                  const next = { ...audio, backgroundTrackPath: v || null };
                  patch('audio', next);
                  void api(endpoints.streamAudio, { method: 'PUT', body: next });
                }}
                placeholder="/media/music/bed.mp3"
              />
              <Toggle
                label="Duck original audio while commentary speaks"
                checked={audio.duckingEnabled}
                onChange={(v) => {
                  const next = { ...audio, duckingEnabled: v };
                  patch('audio', next);
                  void api(endpoints.streamAudio, { method: 'PUT', body: next });
                }}
              />
              <Slider
                label="Duck amount"
                value={audio.duckAmount}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => {
                  const next = { ...audio, duckAmount: v };
                  patch('audio', next);
                  void api(endpoints.streamAudio, { method: 'PUT', body: next });
                }}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <Toggle
                label="Mute all audio"
                checked={audio.masterMute}
                onChange={(v) => {
                  const next = { ...audio, masterMute: v };
                  patch('audio', next);
                  void api(endpoints.streamAudio, { method: 'PUT', body: next });
                }}
              />
              <p className="text-xs text-slate-500">
                Ducking and original-audio volume live inside the FFmpeg filter graph, so changing them triggers a
                one-second pipeline rebuild.
              </p>
            </div>
          ) : (
            <Empty>Audio settings unavailable.</Empty>
          )}
        </Card>

        <Card title="Replays" subtitle="Optional rolling buffer — adds latency, so it is off by default">
          {replay ? (
            <div className="space-y-4">
              <Toggle
                label="Enable replay buffer"
                description="Continuously records short segments so clips can be cut after major events"
                checked={replay.enabled}
                onChange={(v) => {
                  const next = { ...replay, enabled: v } as ReplaySettings;
                  patch('replay', next);
                  void api(endpoints.streamReplay, { method: 'PUT', body: next });
                }}
              />
              <Slider
                label="Pre-roll"
                value={replay.preRollSeconds}
                min={2}
                max={30}
                onChange={(v) => {
                  const next = { ...replay, preRollSeconds: v } as ReplaySettings;
                  patch('replay', next);
                  void api(endpoints.streamReplay, { method: 'PUT', body: next });
                }}
                format={(v) => `${v}s before`}
              />
              <Slider
                label="Post-roll"
                value={replay.postRollSeconds}
                min={1}
                max={20}
                onChange={(v) => {
                  const next = { ...replay, postRollSeconds: v } as ReplaySettings;
                  patch('replay', next);
                  void api(endpoints.streamReplay, { method: 'PUT', body: next });
                }}
                format={(v) => `${v}s after`}
              />
              <Slider
                label="Playback speed"
                value={replay.playbackRate}
                min={0.25}
                max={1}
                step={0.05}
                onChange={(v) => {
                  const next = { ...replay, playbackRate: v } as ReplaySettings;
                  patch('replay', next);
                  void api(endpoints.streamReplay, { method: 'PUT', body: next });
                }}
                format={(v) => `${v.toFixed(2)}x`}
              />
              <Select
                label="Insertion mode"
                value={replay.mode}
                options={[
                  { value: 'off', label: 'Off — archive clips only (no added latency)' },
                  { value: 'cut', label: 'Cut to replay (brief reconnect)' },
                  { value: 'overlay', label: 'Overlay channel (reserved)' },
                ]}
                onChange={(v) => {
                  const next = { ...replay, mode: v } as ReplaySettings;
                  patch('replay', next);
                  void api(endpoints.streamReplay, { method: 'PUT', body: next });
                }}
              />
              <div>
                <p className="label">Trigger events</p>
                <div className="flex flex-wrap gap-2">
                  {['FOUR', 'SIX', 'WICKET', 'MILESTONE'].map((type) => {
                    const active = replay.triggerEvents.includes(type as never);
                    return (
                      <button
                        key={type}
                        onClick={() => {
                          const events = active ? replay.triggerEvents.filter((t) => t !== type) : [...replay.triggerEvents, type];
                          const next = { ...replay, triggerEvents: events } as ReplaySettings;
                          patch('replay', next);
                          void api(endpoints.streamReplay, { method: 'PUT', body: next });
                        }}
                        className={`chip border ${active ? 'border-accent/60 bg-accent/15 text-accent' : 'border-white/10 bg-white/5 text-slate-400'}`}
                      >
                        {type}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <Empty>Replay settings unavailable.</Empty>
          )}
        </Card>
      </div>
    </div>
  );
}
