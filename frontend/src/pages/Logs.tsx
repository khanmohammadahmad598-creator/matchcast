import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Card, Empty } from '../components/ui';

const LEVELS = ['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG'] as const;
const SOURCES = ['ALL', 'ffmpeg', 'ai', 'tts', 'youtube', 'backend', 'stream-worker', 'graphics-worker', 'system'] as const;

export function Logs() {
  const { logs } = useStore();
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('ALL');
  const [source, setSource] = useState<(typeof SOURCES)[number]>('ALL');
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () =>
      logs.filter(
        (l) =>
          (level === 'ALL' || l.level === level) &&
          (source === 'ALL' || l.source === source) &&
          (!query || `${l.message} ${JSON.stringify(l.meta ?? {})}`.toLowerCase().includes(query.toLowerCase())),
      ),
    [logs, level, source, query],
  );

  const counts = useMemo(() => {
    const map = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0 } as Record<string, number>;
    for (const l of logs) map[l.level] = (map[l.level] ?? 0) + 1;
    return map;
  }, [logs]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">System logs</h1>
        <p className="text-sm text-slate-500">
          Live tail from the backend and both workers. Secrets such as stream keys are redacted before they reach the
          browser.
        </p>
      </div>

      <Card
        title="Filters"
        actions={
          <div className="flex flex-wrap gap-2">
            {LEVELS.map((l) => (
              <button
                key={l}
                onClick={() => setLevel(l)}
                className={`chip border ${level === l ? 'border-accent/60 bg-accent/15 text-accent' : 'border-white/10 bg-white/5 text-slate-400'}`}
              >
                {l} {l !== 'ALL' ? `(${counts[l] ?? 0})` : ''}
              </button>
            ))}
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="input max-w-[220px]"
            value={source}
            onChange={(e) => setSource(e.target.value as (typeof SOURCES)[number])}
          >
            {SOURCES.map((s) => (
              <option key={s} value={s} className="bg-ink-800">
                {s === 'ALL' ? 'All sources' : s}
              </option>
            ))}
          </select>
          <input className="input max-w-[320px]" placeholder="Search messages…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <span className="text-xs text-slate-500">{filtered.length} entries</span>
        </div>
      </Card>

      <Card title="Log stream">
        <div className="max-h-[65vh] overflow-auto rounded-lg border border-white/5">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-ink-700/90 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Level</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                    <Empty>No log entries match the current filters.</Empty>
                  </td>
                </tr>
              )}
              {filtered.map((l, i) => (
                <tr key={`${l.createdAt}-${i}`} className="align-top hover:bg-white/[0.03]">
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">{new Date(l.createdAt).toLocaleTimeString()}</td>
                  <td className="px-3 py-1.5">
                    <span
                      className={`chip ${
                        l.level === 'ERROR'
                          ? 'bg-danger/15 text-danger'
                          : l.level === 'WARN'
                            ? 'bg-warn/15 text-warn'
                            : l.level === 'DEBUG'
                              ? 'bg-white/10 text-slate-400'
                              : 'bg-accent/10 text-accent'
                      }`}
                    >
                      {l.level}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-slate-400">{l.source}</td>
                  <td className="px-3 py-1.5 text-slate-200">
                    {l.message}
                    {l.meta && Object.keys(l.meta).length > 0 && (
                      <span className="ml-2 text-slate-500">{JSON.stringify(l.meta)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
