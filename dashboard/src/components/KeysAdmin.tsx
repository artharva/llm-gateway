import { useState, type FormEvent } from 'react';
import type { Api, ApiKey, KeyInput } from '../api';
import { usePolling } from '../hooks';
import type { Palette } from '../theme';
import { Badge } from './Badge';
import { BudgetMeter } from './BudgetMeter';
import { Card, Empty } from './Card';

const toInt = (s: string) => (s.trim() === '' ? undefined : Number.parseInt(s, 10));

export function KeysAdmin({ api, palette }: { api: Api; palette: Palette }) {
  const keys = usePolling(() => api.listKeys(), 15_000, [api]);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<{ name: string; key: string }>();

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      keys.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="grid">
      <Card
        className="span-12"
        title="Create a key"
        subtitle="The key is shown once. The gateway stores only its hash."
      >
        <CreateForm
          onCreate={(input) =>
            act(async () => {
              const k = await api.createKey(input);
              setCreated({ name: k.name, key: k.key });
            })
          }
        />
        {created && (
          <div className="new-key">
            <strong>Key for {created.name}</strong>
            <code>{created.key}</code>
            <span className="meta">Copy it now. It can't be shown again.</span>
            <div>
              <button
                className="ghost"
                onClick={() => void navigator.clipboard?.writeText(created.key)}
              >
                Copy
              </button>{' '}
              <button className="ghost" onClick={() => setCreated(undefined)}>
                Done
              </button>
            </div>
          </div>
        )}
      </Card>

      {(error || keys.error) && <div className="error-banner span-12">{error ?? keys.error}</div>}

      <Card
        className="span-12"
        title="Keys"
        subtitle="Edit limits inline. Changes apply within a few seconds."
      >
        {!keys.data ? (
          <Empty>{keys.loading ? 'Loading…' : 'Could not load keys.'}</Empty>
        ) : keys.data.length === 0 ? (
          <Empty>No keys yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Owner</th>
                  <th>Key</th>
                  <th>Status</th>
                  <th className="num">Rate / min</th>
                  <th className="num">Burst</th>
                  <th className="num">Monthly tokens</th>
                  <th>Used this month</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.data.map((k) => (
                  <KeyRow
                    key={`${k.id}:${k.rate_per_min}:${k.burst}:${k.monthly_token_budget}`}
                    k={k}
                    palette={palette}
                    onSave={(input) => act(() => api.updateKey(k.id, input))}
                    onRevoke={() => {
                      if (
                        window.confirm(
                          `Revoke "${k.name}"? Requests with this key will be rejected.`,
                        )
                      ) {
                        void act(() => api.revokeKey(k.id));
                      }
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function CreateForm({ onCreate }: { onCreate: (input: KeyInput) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const s = (k: string) => String(data.get(k) ?? '');
    setBusy(true);
    await onCreate({
      name: s('name').trim(),
      owner: s('owner').trim() || undefined,
      rate_per_min: toInt(s('rate_per_min')),
      burst: toInt(s('burst')),
      monthly_token_budget: toInt(s('monthly_token_budget')),
    });
    setBusy(false);
    form.reset();
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <label>
        Name
        <input type="text" name="name" required maxLength={100} placeholder="agentloop" />
      </label>
      <label>
        Owner
        <input type="text" name="owner" maxLength={100} placeholder="optional" />
      </label>
      <label>
        Rate / min
        <input type="number" name="rate_per_min" min={1} placeholder="60" />
      </label>
      <label>
        Burst
        <input type="number" name="burst" min={1} placeholder="10" />
      </label>
      <label>
        Monthly tokens
        <input
          type="number"
          name="monthly_token_budget"
          min={0}
          placeholder="1000000 (0 = no limit)"
        />
      </label>
      <button className="primary" type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create key'}
      </button>
    </form>
  );
}

interface RowProps {
  k: ApiKey;
  palette: Palette;
  onSave: (input: KeyInput) => Promise<void>;
  onRevoke: () => void;
}

function KeyRow({ k, palette, onSave, onRevoke }: RowProps) {
  const [rate, setRate] = useState(String(k.rate_per_min));
  const [burst, setBurst] = useState(String(k.burst));
  const [budget, setBudget] = useState(String(k.monthly_token_budget));
  const revoked = k.revoked_at !== null;
  const dirty =
    rate !== String(k.rate_per_min) ||
    burst !== String(k.burst) ||
    budget !== String(k.monthly_token_budget);

  return (
    <tr className={revoked ? 'revoked' : ''}>
      <td>{k.name}</td>
      <td>{k.owner ?? <span className="meta">–</span>}</td>
      <td>
        <code>{k.key_prefix}…</code>
      </td>
      <td>
        {revoked ? <Badge tone="muted" label="Revoked" /> : <Badge tone="good" label="Active" />}
      </td>
      <td className="num">
        <input
          type="number"
          min={1}
          value={rate}
          disabled={revoked}
          onChange={(e) => setRate(e.target.value)}
          aria-label={`Rate per minute for ${k.name}`}
        />
      </td>
      <td className="num">
        <input
          type="number"
          min={1}
          value={burst}
          disabled={revoked}
          onChange={(e) => setBurst(e.target.value)}
          aria-label={`Burst for ${k.name}`}
        />
      </td>
      <td className="num">
        <input
          type="number"
          min={0}
          value={budget}
          disabled={revoked}
          onChange={(e) => setBudget(e.target.value)}
          aria-label={`Monthly token budget for ${k.name}`}
        />
      </td>
      <td>
        <BudgetMeter
          used={k.used_this_month ?? 0}
          budget={k.monthly_token_budget}
          palette={palette}
        />
      </td>
      <td>
        {!revoked && (
          <div className="row-actions">
            <button
              className="primary"
              disabled={!dirty}
              onClick={() =>
                void onSave({
                  rate_per_min: toInt(rate),
                  burst: toInt(burst),
                  monthly_token_budget: toInt(budget),
                })
              }
            >
              Save
            </button>
            <button className="danger" onClick={onRevoke}>
              Revoke
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
