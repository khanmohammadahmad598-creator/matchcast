import { NavLink, useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { StatusDot } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◉' },
  { to: '/match', label: 'Match Control', icon: '🏏' },
  { to: '/commentary', label: 'Commentary', icon: '🎙️' },
  { to: '/graphics', label: 'Graphics', icon: '🎨' },
  { to: '/streaming', label: 'Streaming', icon: '📡' },
  { to: '/logs', label: 'System Logs', icon: '📋' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { user, logout, stream, connected, workers } = useStore();

  const live = stream?.running && (stream.state === 'CONNECTED' || stream.state === 'CONNECTING');

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-white/5 bg-ink-800/60 md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent font-bold text-ink-900">M</div>
          <div>
            <p className="text-sm font-semibold text-slate-100">MatchCast</p>
            <p className="text-[11px] text-slate-500">Live sports broadcasting</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  isActive ? 'bg-accent/10 text-accent' : 'text-slate-300 hover:bg-white/5'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 px-3 pb-4 text-xs text-slate-500">
          <div className="rounded-lg border border-white/5 p-3">
            <p className="mb-1.5 font-medium text-slate-300">Workers</p>
            {workers.length === 0 && <p className="text-slate-500">No workers connected</p>}
            {workers.map((w) => (
              <div key={w.name} className="flex items-center justify-between py-0.5">
                <span>{w.name}</span>
                <StatusDot state={w.online ? 'CONNECTED' : 'IDLE'} />
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-white/5 bg-ink-800/40 px-5 py-3">
          <div className="flex items-center gap-3">
            <span
              className={`chip ${live ? 'bg-danger/20 text-danger' : 'bg-white/10 text-slate-400'}`}
              title={stream?.state ?? 'IDLE'}
            >
              <StatusDot state={stream?.state ?? 'IDLE'} />
              {live ? 'ON AIR' : (stream?.state ?? 'OFFLINE')}
            </span>
            <span className="hidden text-xs text-slate-500 sm:inline">
              {connected ? 'Realtime connected' : 'Realtime disconnected'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <span className="hidden text-xs text-slate-400 sm:inline">
                {user.email} · <span className="text-accent">{user.role}</span>
              </span>
            )}
            <button
              className="btn-ghost"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>

        {/* Mobile nav */}
        <nav className="flex justify-around border-t border-white/5 bg-ink-800/80 py-2 md:hidden">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `flex flex-col items-center text-[10px] ${isActive ? 'text-accent' : 'text-slate-400'}`}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label.split(' ')[0]}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
