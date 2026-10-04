import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { MatchControl } from './pages/MatchControl';
import { Commentary } from './pages/Commentary';
import { GraphicsPage } from './pages/Graphics';
import { Streaming } from './pages/Streaming';
import { Logs } from './pages/Logs';
import { useStore } from './state/store';

export default function App() {
  const { token, booted, bootstrap } = useStore();

  useEffect(() => {
    if (token && !booted) void bootstrap();
  }, [token, booted, bootstrap]);

  if (!token) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (!booted) {
    return (
      <div className="grid h-screen place-items-center text-sm text-slate-400">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Loading MatchCast…
        </div>
      </div>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/match" element={<MatchControl />} />
        <Route path="/commentary" element={<Commentary />} />
        <Route path="/graphics" element={<GraphicsPage />} />
        <Route path="/streaming" element={<Streaming />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
