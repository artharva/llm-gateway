import type { Pool } from 'pg';
import { displayPrefix, generateApiKey, hashApiKey } from '../keys';

export interface ApiKeyRecord {
  id: number;
  name: string;
  owner: string | null;
  keyPrefix: string;
  ratePerMin: number;
  burst: number;
  monthlyTokenBudget: number;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface NewApiKey {
  name: string;
  owner?: string | null;
  ratePerMin?: number;
  burst?: number;
  monthlyTokenBudget?: number;
}

export type ApiKeyPatch = Partial<
  Pick<ApiKeyRecord, 'name' | 'owner' | 'ratePerMin' | 'burst' | 'monthlyTokenBudget'>
>;

export interface KeyStore {
  findByHash(hash: string): Promise<ApiKeyRecord | null>;
  /** Returns the record and the plaintext key, which is never stored and cannot be shown again. */
  create(input: NewApiKey): Promise<{ record: ApiKeyRecord; key: string }>;
  list(): Promise<ApiKeyRecord[]>;
  get(id: number): Promise<ApiKeyRecord | null>;
  update(id: number, patch: ApiKeyPatch): Promise<ApiKeyRecord | null>;
  revoke(id: number): Promise<ApiKeyRecord | null>;
}

export const KEY_DEFAULTS = { ratePerMin: 60, burst: 60, monthlyTokenBudget: 1_000_000 };

interface Row {
  id: number;
  name: string;
  owner: string | null;
  key_prefix: string;
  rate_per_min: number;
  burst: number;
  monthly_token_budget: string;
  created_at: Date;
  revoked_at: Date | null;
}

const COLUMNS =
  'id, name, owner, key_prefix, rate_per_min, burst, monthly_token_budget, created_at, revoked_at';

function toRecord(r: Row): ApiKeyRecord {
  return {
    id: r.id,
    name: r.name,
    owner: r.owner,
    keyPrefix: r.key_prefix,
    ratePerMin: r.rate_per_min,
    burst: r.burst,
    monthlyTokenBudget: Number(r.monthly_token_budget),
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
  };
}

export class PgKeyStore implements KeyStore {
  constructor(private readonly pool: Pool) {}

  async findByHash(hash: string): Promise<ApiKeyRecord | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM api_keys WHERE key_hash = $1`,
      [hash],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async create(input: NewApiKey): Promise<{ record: ApiKeyRecord; key: string }> {
    const key = generateApiKey();
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO api_keys (name, owner, key_prefix, key_hash, rate_per_min, burst, monthly_token_budget)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
      [
        input.name,
        input.owner ?? null,
        displayPrefix(key),
        hashApiKey(key),
        input.ratePerMin ?? KEY_DEFAULTS.ratePerMin,
        input.burst ?? input.ratePerMin ?? KEY_DEFAULTS.burst,
        input.monthlyTokenBudget ?? KEY_DEFAULTS.monthlyTokenBudget,
      ],
    );
    return { record: toRecord(rows[0]!), key };
  }

  async list(): Promise<ApiKeyRecord[]> {
    const { rows } = await this.pool.query<Row>(`SELECT ${COLUMNS} FROM api_keys ORDER BY id`);
    return rows.map(toRecord);
  }

  async get(id: number): Promise<ApiKeyRecord | null> {
    const { rows } = await this.pool.query<Row>(`SELECT ${COLUMNS} FROM api_keys WHERE id = $1`, [
      id,
    ]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async update(id: number, patch: ApiKeyPatch): Promise<ApiKeyRecord | null> {
    const columns: Record<keyof ApiKeyPatch, string> = {
      name: 'name',
      owner: 'owner',
      ratePerMin: 'rate_per_min',
      burst: 'burst',
      monthlyTokenBudget: 'monthly_token_budget',
    };
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [field, column] of Object.entries(columns) as [keyof ApiKeyPatch, string][]) {
      if (patch[field] === undefined) continue;
      values.push(patch[field]);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length === 0) return this.get(id);
    values.push(id);
    const { rows } = await this.pool.query<Row>(
      `UPDATE api_keys SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${COLUMNS}`,
      values,
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async revoke(id: number): Promise<ApiKeyRecord | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 RETURNING ${COLUMNS}`,
      [id],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }
}

/** In-memory store for unit tests and local experiments. */
export class MemoryKeyStore implements KeyStore {
  private readonly byId = new Map<number, ApiKeyRecord & { hash: string }>();
  private nextId = 1;

  async findByHash(hash: string): Promise<ApiKeyRecord | null> {
    for (const r of this.byId.values()) if (r.hash === hash) return strip(r);
    return null;
  }

  async create(input: NewApiKey): Promise<{ record: ApiKeyRecord; key: string }> {
    const key = generateApiKey();
    const record = {
      id: this.nextId++,
      name: input.name,
      owner: input.owner ?? null,
      keyPrefix: displayPrefix(key),
      ratePerMin: input.ratePerMin ?? KEY_DEFAULTS.ratePerMin,
      burst: input.burst ?? input.ratePerMin ?? KEY_DEFAULTS.burst,
      monthlyTokenBudget: input.monthlyTokenBudget ?? KEY_DEFAULTS.monthlyTokenBudget,
      createdAt: new Date(),
      revokedAt: null,
      hash: hashApiKey(key),
    };
    this.byId.set(record.id, record);
    return { record: strip(record), key };
  }

  async list(): Promise<ApiKeyRecord[]> {
    return [...this.byId.values()].map(strip);
  }

  async get(id: number): Promise<ApiKeyRecord | null> {
    const r = this.byId.get(id);
    return r ? strip(r) : null;
  }

  async update(id: number, patch: ApiKeyPatch): Promise<ApiKeyRecord | null> {
    const r = this.byId.get(id);
    if (!r) return null;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) Object.assign(r, { [k]: v });
    return strip(r);
  }

  async revoke(id: number): Promise<ApiKeyRecord | null> {
    const r = this.byId.get(id);
    if (!r) return null;
    r.revokedAt ??= new Date();
    return strip(r);
  }
}

function strip(r: ApiKeyRecord & { hash: string }): ApiKeyRecord {
  const { hash: _hash, ...record } = r;
  return { ...record };
}
