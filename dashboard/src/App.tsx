import { useMemo, useState, type FormEvent } from 'react';
import { ApiError, createApi, type Api, type Range } from './api';
import { CostByKey } from './components/CostByKey';
import { KeysAdmin } from './components/KeysAdmin';
import { KeysUsageTable } from './components/KeysUsageTable';
import { LatencyChart } from './components/LatencyChart';
import { ProvidersTable } from './components/ProvidersTable';
import { StatTiles } from './components/StatTiles';
import { TrafficChart } from './components/TrafficChart';
import { usePolling } from './hooks';
import { useTheme, type Palette } from './theme';

const TOKEN_KEY = 'gateway.adminToken';
const RANGES: Range[] = ['15m', '1h', '24h', '7d'];
const REFRESH_MS = 10_000;

function storedToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function App() {
  const [token, setToken] = useState(storedToken);
  const { theme, palette, cycle } = useTheme();
  const api = useMemo(() => createApi(token), [token]);

  const signIn = (t: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      // Kept for this tab only.
    }
    setToken(t);
  };
  const signOut = () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Nothing stored.
    }
    setToken('');
  };

  if (!token) return <Login onSubmit={signIn} />;
  return (
    <Dashboard api={api} palette={palette} theme={theme} onTheme={cycle} onSignOut={signOut} />
  );
}

interface DashboardProps {
  api: Api;
  palette: Palette;
  theme: string;
  onTheme: () => void;
  onSignOut: () => void;
}

function Dashboard({ api, palette, theme, onTheme, onSignOut }: DashboardProps) {
  const [tab, setTab] = useState<'overview' | 'keys'>('overview');
  const [range, setRange] = useState<Range>('1h');

  const stats = usePolling(
    async () => {
      const [overview, timeseries, keys, providers] = await Promise.all([
        api.overview(range),
        api.timeseries(range),
        api.keyStats(range),
        api.providers(range),
      ]);
      return { overview, timeseries, keys, providers };
    },
    REFRESH_MS,
    [api, range],
  );

  const unauthorized = stats.error !== undefined && /admin token/i.test(stats.error);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          LLM Gateway
          <small>
            {stats.updatedAt ? `Updated ${stats.updatedAt.toLocaleTimeString()}` : 'Loading…'} ·
            refreshes every {REFRESH_MS / 1000}s
          </small>
        </div>
        <nav className="tabs" aria-label="Sections">
          <button aria-pressed={tab === 'overview'} onClick={() => setTab('overview')}>
            Overview
          </button>
          <button aria-pressed={tab === 'keys'} onClick={() => setTab('keys')}>
            Keys
          </button>
        </nav>
        {tab === 'overview' && (
          <div className="segmented" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        )}
        <button className="ghost" onClick={onTheme} title="Switch theme">
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        <button className="ghost" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      {stats.error && (
        <div className="error-banner">
          {unauthorized
            ? 'The admin token was rejected. Sign out and enter the ADMIN_TOKEN from .env.'
            : `Could not reach the gateway: ${stats.error}`}
        </div>
      )}

      {tab === 'overview' ? (
        <>
          <StatTiles o={stats.data?.overview} />
          <div className="grid">
            <TrafficChart points={stats.data?.timeseries} range={range} palette={palette} />
            <LatencyChart points={stats.data?.timeseries} range={range} palette={palette} />
            <ProvidersTable providers={stats.data?.providers} />
            <CostByKey keys={stats.data?.keys} palette={palette} />
            <KeysUsageTable keys={stats.data?.keys} palette={palette} />
          </div>
        </>
      ) : (
        <KeysAdmin api={api} palette={palette} />
      )}
    </div>
  );
}

function Login({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await createApi(value.trim()).overview('15m');
      onSubmit(value.trim());
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'That token was rejected.'
          : String((err as Error).message),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <form className="card login" onSubmit={(e) => void submit(e)}>
        <div className="card-head">
          <div>
            <h2>LLM Gateway dashboard</h2>
            <p>Enter the ADMIN_TOKEN the gateway was started with.</p>
          </div>
        </div>
        <label>
          Admin token
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            required
          />
        </label>
        {error && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{error}</p>}
        <p>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Open dashboard'}
          </button>
        </p>
      </form>
    </div>
  );
}
