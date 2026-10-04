import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';

export function Login() {
  const [email, setEmail] = useState('admin@matchcast.local');
  const [password, setPassword] = useState('ChangeMeNow123!');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const login = useStore((s) => s.login);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-lg font-bold text-ink-900">M</div>
          <div>
            <h1 className="text-lg font-semibold text-slate-100">MatchCast</h1>
            <p className="text-xs text-slate-500">Sign in to the broadcast console</p>
          </div>
        </div>

        <form onSubmit={submit} className="card space-y-4">
          <label className="block">
            <span className="label">Email</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="block">
            <span className="label">Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-center text-[11px] leading-relaxed text-slate-500">
            Default admin is seeded on first boot.
            <br />
            Change the password immediately in production.
          </p>
        </form>
      </div>
    </div>
  );
}
