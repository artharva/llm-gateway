import { Router } from 'express';
import type { Metrics } from '../metrics/metrics';
import type { Provider } from '../providers/Provider';
import type { CircuitBreakers } from '../reliability/CircuitBreaker';

export interface HealthDeps {
  providers: Map<string, Provider>;
  breakers: CircuitBreakers;
  checkPostgres?: () => Promise<boolean>;
  checkRedis?: () => Promise<boolean>;
  metrics?: Metrics;
}

const startedAt = Date.now();

async function safe(check?: () => Promise<boolean>): Promise<'up' | 'down' | 'not_configured'> {
  if (!check) return 'not_configured';
  try {
    return (await check()) ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

export function healthRoutes(deps: HealthDeps): Router {
  const router = Router();

  /**
   * 200 "ok": everything up. 200 "degraded": Redis down (the gateway fails
   * open) or a provider's breaker is open. 503 "down": Postgres is down, so
   * new keys cannot be checked and nothing is logged.
   * ?deep=true also calls every provider's health check.
   */
  router.get('/health', async (req, res) => {
    const deep = req.query.deep === 'true';
    const [postgres, redis] = await Promise.all([safe(deps.checkPostgres), safe(deps.checkRedis)]);
    const providers = await Promise.all(
      [...deps.providers.values()].map(async (p) => {
        const snap = await deps.breakers.snapshot(p.name);
        return {
          name: p.name,
          model: p.model,
          breaker: snap.state,
          recent_failures: snap.recentFailures,
          ...(deep
            ? { reachable: await p.healthCheck(AbortSignal.timeout(3000)).catch(() => false) }
            : {}),
        };
      }),
    );
    const status =
      postgres === 'down'
        ? 'down'
        : redis === 'down' || providers.some((p) => p.breaker !== 'closed')
          ? 'degraded'
          : 'ok';
    res.status(status === 'down' ? 503 : 200).json({
      status,
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      checks: { postgres, redis },
      providers,
    });
  });

  router.get('/metrics', async (_req, res) => {
    if (!deps.metrics) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', deps.metrics.registry.contentType);
    res.send(await deps.metrics.registry.metrics());
  });

  return router;
}
