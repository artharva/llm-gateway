import crypto from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { ApiKeyRecord, KeyStore } from '../db/keyStore';
import { RANGES, type Range, type StatsSource } from '../db/statsRepo';
import { HttpError } from '../errors';
import type { BudgetTracker } from '../limits/BudgetTracker';
import type { KeyResolver } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import type { CircuitBreakers } from '../reliability/CircuitBreaker';

export interface AdminDeps {
  adminToken?: string;
  store: KeyStore;
  resolver: KeyResolver;
  stats: StatsSource;
  budget: BudgetTracker;
  breakers: CircuitBreakers;
  providerNames: string[];
}

const limitsSchema = {
  rate_per_min: z.number().int().positive().max(1_000_000).optional(),
  burst: z.number().int().positive().max(1_000_000).optional(),
  monthly_token_budget: z.number().int().min(0).max(1e12).optional(),
};
const createSchema = z
  .object({
    name: z.string().min(1).max(100),
    owner: z.string().max(100).optional(),
    ...limitsSchema,
  })
  .strict();
const patchSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    owner: z.string().max(100).nullable().optional(),
    ...limitsSchema,
  })
  .strict();
const rangeSchema = z.enum(Object.keys(RANGES) as [Range, ...Range[]]).default('1h');

function requireAdmin(token: string | undefined): RequestHandler {
  return (req, _res, next) => {
    if (!token)
      throw new HttpError(503, 'admin_disabled', 'Set ADMIN_TOKEN to enable the admin API');
    const given = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '')?.[1] ?? '';
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new HttpError(401, 'invalid_admin_token', 'Admin token is missing or wrong');
    }
    next();
  };
}

function view(r: ApiKeyRecord) {
  return {
    id: r.id,
    name: r.name,
    owner: r.owner,
    key_prefix: r.keyPrefix,
    rate_per_min: r.ratePerMin,
    burst: r.burst,
    monthly_token_budget: r.monthlyTokenBudget,
    created_at: r.createdAt,
    revoked_at: r.revokedAt,
  };
}

function idParam(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0)
    throw new HttpError(400, 'invalid_id', 'Key id must be a positive integer');
  return id;
}

/** Key management and dashboard data, behind ADMIN_TOKEN. */
export function adminRoutes(deps: AdminDeps): Router {
  const router = Router();
  router.use('/admin', requireAdmin(deps.adminToken));

  router.get('/admin/keys', async (_req, res) => {
    const keys = await deps.store.list();
    const used = await Promise.all(keys.map((k) => deps.budget.used(k.id)));
    res.json(keys.map((k, i) => ({ ...view(k), used_this_month: used[i] })));
  });

  router.post('/admin/keys', validateBody(createSchema), async (_req, res) => {
    const body = res.locals.body as z.infer<typeof createSchema>;
    const { record, key } = await deps.store.create({
      name: body.name,
      owner: body.owner ?? null,
      ratePerMin: body.rate_per_min,
      burst: body.burst,
      monthlyTokenBudget: body.monthly_token_budget,
    });
    // The plaintext key is shown once, here, and never stored.
    res.status(201).json({ ...view(record), key });
  });

  router.patch('/admin/keys/:id', validateBody(patchSchema), async (req, res) => {
    const body = res.locals.body as z.infer<typeof patchSchema>;
    const updated = await deps.store.update(idParam(String(req.params.id)), {
      name: body.name,
      owner: body.owner,
      ratePerMin: body.rate_per_min,
      burst: body.burst,
      monthlyTokenBudget: body.monthly_token_budget,
    });
    if (!updated) throw new HttpError(404, 'key_not_found', 'No key with that id');
    deps.resolver.invalidate();
    res.json(view(updated));
  });

  router.post('/admin/keys/:id/revoke', async (req, res) => {
    const revoked = await deps.store.revoke(idParam(String(req.params.id)));
    if (!revoked) throw new HttpError(404, 'key_not_found', 'No key with that id');
    deps.resolver.invalidate();
    res.json(view(revoked));
  });

  const range = (q: unknown): Range => {
    const parsed = rangeSchema.safeParse(q);
    if (!parsed.success)
      throw new HttpError(
        400,
        'invalid_range',
        `range must be one of ${Object.keys(RANGES).join(', ')}`,
      );
    return parsed.data;
  };

  router.get('/admin/stats/overview', async (req, res) => {
    res.json(await deps.stats.overview(range(req.query.range)));
  });

  router.get('/admin/stats/timeseries', async (req, res) => {
    res.json(await deps.stats.timeseries(range(req.query.range)));
  });

  router.get('/admin/stats/keys', async (req, res) => {
    const rows = await deps.stats.keys(range(req.query.range));
    const used = await Promise.all(rows.map((r) => deps.budget.used(r.id)));
    res.json(rows.map((r, i) => ({ ...r, used_this_month: used[i] })));
  });

  router.get('/admin/stats/providers', async (req, res) => {
    const usage = await deps.stats.providers(range(req.query.range));
    const breakers = await Promise.all(
      deps.providerNames.map((name) => deps.breakers.snapshot(name)),
    );
    const empty = { requests: 0, fallbacks: 0, p50_ms: 0, p95_ms: 0, tokens: 0, cost_usd: 0 };
    res.json(
      deps.providerNames.map((name, i) => {
        const { provider: _provider, ...stats } = usage.find((u) => u.provider === name) ?? {
          provider: name,
          ...empty,
        };
        return {
          provider: name,
          breaker: breakers[i]!.state,
          recent_failures: breakers[i]!.recentFailures,
          opened_at: breakers[i]!.openedAt,
          ...stats,
        };
      }),
    );
  });

  return router;
}
