import { useStore } from '../state/store';
import { VideoPreview } from '../components/VideoPreview';
import { Badge, Card, Empty, Stat, StatusDot } from '../components/ui';

function fmtBitrate(kbps: number): string {
  if (!kbps) return '—';
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(2)} Mbps` : `${Math.round(kbps)} kbps`;
}

export function Dashboard() {
  const { score, stream, stats, commentary, workers, matchId } = useStore();
  const lastLines = commentary.slice(-6).reverse();

  const live = Boolean(stream?.running && stream.state === 'CONNECTED');
  const inputState = stream?.input?.state ?? 'IDLE';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Broadcast Dashboard</h1>
          <p className="text-sm text-slate-500">
            {score ? `${score.title} · ${score.tournament ?? ''}` : 'No match selected'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={live ? 'good' : 'neutral'}>
            <StatusDot state={stream?.state ?? 'IDLE'} />
            {live ? 'Live on YouTube' : (stream?.state ?? 'Offline')}
          </Badge>
          <Badge tone={inputState === 'CONNECTED' ? 'good' : inputState === 'ERROR' ? 'bad' : 'neutral'}>
            Input {inputState}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Stat
          label="YouTube"
          value={live ? 'LIVE' : 'OFFLINE'}
          tone={live ? 'good' : 'default'}
          hint={`${stream?.output.reconnectCount ?? 0} reconnects`}
        />
        <Stat
          label="Bitrate"
          value={fmtBitrate(stream?.bitrateKbps ?? 0)}
          tone={(stream?.bitrateKbps ?? 0) > 0 ? 'good' : 'default'}
          hint={`target ${fmtBitrate(stream?.output.bitrateKbps ?? 0)}`}
        />
        <Stat label="FPS" value={stream?.fps ?? 0} hint={`speed ${(stream?.speed ?? 0).toFixed(2)}x`} />
        <Stat
          label="CPU"
          value={`${Math.round(stats?.cpuPercent ?? 0)}%`}
          tone={(stats?.cpuPercent ?? 0) > 85 ? 'warn' : 'default'}
          hint={`load ${(stats?.loadAverage?.[0] ?? 0).toFixed(2)}`}
        />
        <Stat
          label="RAM"
          value={`${Math.round(stats?.memPercent ?? 0)}%`}
          tone={(stats?.memPercent ?? 0) > 90 ? 'warn' : 'default'}
          hint={`${stats?.memUsedMb ?? 0} / ${stats?.memTotalMb ?? 0} MB`}
        />
        <Stat
          label="GPU"
          value={stats?.gpu ? `${stats.gpu.utilPercent}%` : 'n/a'}
          hint={stats?.gpu ? stats.gpu.name : 'No NVIDIA GPU detected'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <VideoPreview className="aspect-video" />

          {score ? (
            <Card title="Current score" subtitle={`Innings ${score.inningsNumber} · ${score.status}`}>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-400">{score.battingTeam.name}</p>
                  <p className="text-4xl font-bold text-accent">
                    {score.runs}/{score.wickets}
                    <span className="ml-2 text-lg font-medium text-slate-400">({score.overs})</span>
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-3">
                  <Metric label="CRR" value={score.runRate.toFixed(2)} />
                  {score.target != null && <Metric label="Target" value={String(score.target)} />}
                  {score.requiredRunRate != null && <Metric label="RRR" value={score.requiredRunRate.toFixed(2)} />}
                  <Metric label="Extras" value={String(score.extras.total)} />
                  <Metric label="Partnership" value={`${score.partnership.runs} (${score.partnership.balls})`} />
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Player label="Striker" name={score.striker?.name} detail={score.striker ? `${score.striker.runs} (${score.striker.balls})` : undefined} />
                <Player label="Non-striker" name={score.nonStriker?.name} detail={score.nonStriker ? `${score.nonStriker.runs} (${score.nonStriker.balls})` : undefined} />
                <Player label="Bowler" name={score.bowler?.name} detail={score.bowler ? `${score.bowler.wickets}/${score.bowler.runs}` : undefined} />
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {score.recentBalls.slice(-12).map((b) => (
                  <span
                    key={b.id}
                    className={`grid h-8 min-w-8 place-items-center rounded-full px-2 text-xs font-bold ${
                      b.isWicket
                        ? 'bg-danger text-white'
                        : b.isSix
                          ? 'bg-accent text-ink-900'
                          : b.isFour
                            ? 'bg-accent/60 text-ink-900'
                            : 'bg-white/10 text-slate-300'
                    }`}
                  >
                    {b.label}
                  </span>
                ))}
              </div>
            </Card>
          ) : (
            <Card title="Current score">
              <Empty>No match selected — create one in Match Control.</Empty>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="AI commentary" subtitle="Most recent lines" >
            <div className="max-h-[420px] space-y-2 overflow-y-auto">
              {lastLines.length === 0 && <Empty>No commentary yet.</Empty>}
              {lastLines.map((c) => (
                <div key={c.id} className="rounded-lg border border-white/5 bg-ink-700/50 p-2.5">
                  <p className="text-sm text-slate-200">{c.text}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {c.language} · {c.style} · {c.provider} · {new Date(c.createdAt).toLocaleTimeString()}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Workers" subtitle="Control-plane connections">
            <div className="space-y-2 text-sm">
              {workers.length === 0 && <Empty>stream-worker / graphics-worker offline.</Empty>}
              {workers.map((w) => (
                <div key={w.name} className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2">
                  <span className="text-slate-300">{w.name}</span>
                  <span className="flex items-center gap-2 text-xs text-slate-400">
                    {Math.round(w.uptimeSeconds)}s <StatusDot state={w.online ? 'CONNECTED' : 'IDLE'} />
                  </span>
                </div>
              ))}
            </div>
            {stream?.lastError && (
              <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{stream.lastError}</p>
            )}
          </Card>

          {matchId && (
            <Card title="Session">
              <dl className="space-y-1 text-sm">
                <Row label="Pipeline generation" value={String(stream?.pipelineGeneration ?? 0)} />
                <Row label="Uptime" value={`${stream?.uptimeSeconds ?? 0}s`} />
                <Row label="Dropped frames" value={String(stream?.droppedFrames ?? 0)} />
                <Row label="Input bitrate" value={fmtBitrate(stream?.input.bitrateKbps ?? 0)} />
                <Row label="Input reconnects" value={String(stream?.input.reconnectCount ?? 0)} />
              </dl>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-base font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function Player({ label, name, detail }: { label: string; name?: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-ink-700/40 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="truncate text-sm font-medium text-slate-100">{name ?? '—'}</p>
      {detail && <p className="text-xs text-slate-400">{detail}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-mono text-slate-200">{value}</dd>
    </div>
  );
}
