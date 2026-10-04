import { useEffect, useState } from 'react';
import { api, endpoints } from '../lib/api';
import { useStore } from '../state/store';
import { Badge, Card, Empty, Field, Select } from '../components/ui';
import type { ScoreSnapshot } from '@matchcast/shared';

interface PlayerRef {
  id: string;
  name: string;
  role: string;
}
interface Squads {
  teamA: { id: string; name: string; players: PlayerRef[] };
  teamB: { id: string; name: string; players: PlayerRef[] };
}

export function MatchControl() {
  const { matches, matchId, score, selectMatch, refreshMatches } = useStore();
  const [squads, setSquads] = useState<Squads | null>(null);
  const [striker, setStriker] = useState('');
  const [nonStriker, setNonStriker] = useState('');
  const [bowler, setBowler] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!matchId) return;
    api<{ snapshot: ScoreSnapshot | null }>(endpoints.matchState(matchId)).catch(() => ({ snapshot: null }));
    api<Squads>(endpoints.matchPlayers(matchId))
      .then((s) => {
        setSquads(s);
        setStriker(s.teamA.players[0]?.id ?? '');
        setNonStriker(s.teamA.players[1]?.id ?? '');
        setBowler(s.teamB.players.find((p) => p.role === 'BOWL')?.id ?? s.teamB.players[0]?.id ?? '');
      })
      .catch(() => setSquads(null));
  }, [matchId]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const current = matches.find((m) => m.id === matchId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Match Control</h1>
          <p className="text-sm text-slate-500">Create matches, start innings and score deliveries</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => void refreshMatches()}>
            Refresh
          </button>
          <button className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Close' : 'Create match'}
          </button>
        </div>
      </div>

      {showCreate && <CreateMatch onCreated={() => { void refreshMatches(); setShowCreate(false); }} />}

      <Card title="Select match">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {matches.length === 0 && <Empty>No matches yet — create one to get started.</Empty>}
          {matches.map((m) => (
            <button
              key={m.id}
              onClick={() => void selectMatch(m.id)}
              className={`rounded-lg border p-3 text-left transition ${
                m.id === matchId ? 'border-accent/60 bg-accent/10' : 'border-white/5 bg-ink-700/40 hover:bg-ink-700'
              }`}
            >
              <p className="truncate text-sm font-medium text-slate-100">{m.title}</p>
              <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <Badge tone={m.status === 'LIVE' ? 'good' : 'neutral'}>{m.status}</Badge>
                {m.format}
              </p>
            </button>
          ))}
        </div>
      </Card>

      {matchId && (
        <>
          <Card
            title="Start / innings"
            subtitle={current ? `${current.teamA.shortName} vs ${current.teamB.shortName}` : undefined}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                label="Striker"
                value={striker}
                options={(squads?.teamA.players ?? []).map((p) => ({ value: p.id, label: p.name }))}
                onChange={setStriker}
              />
              <Select
                label="Non-striker"
                value={nonStriker}
                options={(squads?.teamA.players ?? []).map((p) => ({ value: p.id, label: p.name }))}
                onChange={setNonStriker}
              />
              <Select
                label="Bowler"
                value={bowler}
                options={(squads?.teamB.players ?? []).map((p) => ({ value: p.id, label: p.name }))}
                onChange={setBowler}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() =>
                  void act(() => api(endpoints.start(matchId), { method: 'POST', body: { strikerId: striker, nonStrikerId: nonStriker, bowlerId: bowler } }))
                }
              >
                Start match
              </button>
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() =>
                  void act(() => api(endpoints.batters(matchId), { method: 'POST', body: { strikerId: striker, nonStrikerId: nonStriker, bowlerId: bowler } }))
                }
              >
                Set batters / bowler
              </button>
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() => void act(() => api(endpoints.innings(matchId), { method: 'POST', body: { strikerId: striker, nonStrikerId: nonStriker, bowlerId: bowler } }))}
              >
                Start next innings
              </button>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Score deliveries" className="lg:col-span-2">
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {[0, 1, 2, 3, 4, 5, 6].map((runs) => (
                  <button
                    key={runs}
                    className="btn-ghost h-14 text-lg font-semibold"
                    disabled={busy}
                    onClick={() => void act(() => api(endpoints.ball(matchId), { method: 'POST', body: { runs, isWicket: false } }))}
                  >
                    {runs}
                  </button>
                ))}
                <button
                  className="btn-danger h-14"
                  disabled={busy}
                  onClick={() => void act(() => api(endpoints.wicket(matchId), { method: 'POST', body: { wicketKind: 'BOWLED', newBatterId: striker } }))}
                >
                  W
                </button>
                <button
                  className="btn-ghost h-14"
                  disabled={busy}
                  onClick={() => void act(() => api(endpoints.ball(matchId), { method: 'POST', body: { runs: 1, extraType: 'WD' } }))}
                >
                  Wide
                </button>
                <button
                  className="btn-ghost h-14"
                  disabled={busy}
                  onClick={() => void act(() => api(endpoints.ball(matchId), { method: 'POST', body: { runs: 1, extraType: 'NB' } }))}
                >
                  No ball
                </button>
                <button
                  className="btn-ghost h-14"
                  disabled={busy}
                  onClick={() => void act(() => api(endpoints.ball(matchId), { method: 'POST', body: { runs: 1, extraType: 'LB' } }))}
                >
                  Leg bye
                </button>
                <button
                  className="btn-ghost h-14"
                  disabled={busy}
                  onClick={() => void act(() => api(endpoints.boundary(matchId), { method: 'POST', body: { runs: 4 } }))}
                >
                  Four
                </button>
                <button
                  className="btn-ghost h-14"
                  disabled={busy}
                  onClick={() => void act(() => api(endpoints.boundary(matchId), { method: 'POST', body: { runs: 6 } }))}
                >
                  Six
                </button>
                <button
                  className="btn-ghost h-14"
                  disabled={busy}
                  onClick={() => void act(() => api(endpoints.undo(matchId), { method: 'POST' }))}
                >
                  Undo
                </button>
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div className="w-32">
                  <Field
                    label="Target"
                    value={String(score?.target ?? '')}
                    onChange={(v) => {
                      if (v) void api(endpoints.target(matchId), { method: 'POST', body: { target: Number(v) } });
                    }}
                    placeholder="—"
                  />
                </div>
                <p className="pb-2 text-xs text-slate-500">
                  Setting a target enables required-run-rate on the scoreboard.
                </p>
              </div>

              {error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
            </Card>

            <Card title="Live snapshot">
              {score ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-slate-400">{score.battingTeam.name}</p>
                    <p className="text-3xl font-bold text-accent">
                      {score.runs}/{score.wickets} <span className="text-base text-slate-400">({score.overs})</span>
                    </p>
                  </div>
                  <dl className="space-y-1 text-sm">
                    <Row label="CRR" value={score.runRate.toFixed(2)} />
                    <Row label="RRR" value={score.requiredRunRate?.toFixed(2) ?? '—'} />
                    <Row label="Extras" value={String(score.extras.total)} />
                    <Row label="Partnership" value={`${score.partnership.runs} (${score.partnership.balls})`} />
                    <Row label="Free hit" value={score.freeHit ? 'Yes' : 'No'} />
                  </dl>
                  <div className="flex flex-wrap gap-1.5">
                    {score.recentBalls.slice(-8).map((b) => (
                      <span
                        key={b.id}
                        className={`grid h-7 min-w-7 place-items-center rounded-full px-1.5 text-[11px] font-bold ${
                          b.isWicket ? 'bg-danger text-white' : b.isSix ? 'bg-accent text-ink-900' : b.isFour ? 'bg-accent/60 text-ink-900' : 'bg-white/10 text-slate-300'
                        }`}
                      >
                        {b.label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <Empty>Start the match to see the score.</Empty>
              )}
            </Card>
          </div>
        </>
      )}
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

function CreateMatch({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('India vs Australia');
  const [tournament, setTournament] = useState('MatchCast Series');
  const [venue, setVenue] = useState('Kanpur');
  const [format, setFormat] = useState('T20');
  const [teamA, setTeamA] = useState('India');
  const [teamB, setTeamB] = useState('Australia');
  const [playersA, setPlayersA] = useState('R Sharma, S Gill, V Kohli, H Pandya, J Bumrah');
  const [playersB, setPlayersB] = useState('D Warner, T Head, S Smith, G Maxwell, M Starc');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(endpoints.matches, {
        method: 'POST',
        body: {
          title,
          tournament,
          venue,
          format,
          oversPerInnings: format === 'T20' ? 20 : format === 'ODI' ? 50 : null,
          teamA: { name: teamA, shortName: teamA.slice(0, 3).toUpperCase(), players: split(playersA) },
          teamB: { name: teamB, shortName: teamB.slice(0, 3).toUpperCase(), players: split(playersB) },
        },
      });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      <h2 className="text-sm font-semibold text-slate-100">New match</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Title" value={title} onChange={setTitle} />
        <Field label="Tournament" value={tournament} onChange={setTournament} />
        <Field label="Venue" value={venue} onChange={setVenue} />
        <Select
          label="Format"
          value={format}
          onChange={setFormat}
          options={[
            { value: 'T20', label: 'T20' },
            { value: 'ODI', label: 'ODI' },
            { value: 'T10', label: 'T10' },
            { value: 'TEST', label: 'TEST' },
          ]}
        />
        <Field label="Team A" value={teamA} onChange={setTeamA} />
        <Field label="Team B" value={teamB} onChange={setTeamB} />
        <div className="sm:col-span-2">
          <Field label="Team A players (comma separated)" value={playersA} onChange={setPlayersA} />
        </div>
        <div className="sm:col-span-2">
          <Field label="Team B players (comma separated)" value={playersB} onChange={setPlayersB} />
        </div>
      </div>
      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      <button className="btn-primary" disabled={busy}>
        {busy ? 'Creating…' : 'Create match'}
      </button>
    </form>
  );
}

function split(value: string): Array<{ name: string; role: string }> {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name, role: 'BAT' }));
}
