import express, { type Request, type Response } from 'express';

/** How one named instance behaves. Each instance (e.g. "primary", "backup") is tuned separately. */
export interface InstanceSettings {
  /** Fixed delay before answering, in ms. */
  delayMs: number;
  /** Extra random delay, 0..jitterMs, added to delayMs. */
  jitterMs: number;
  /** Share of requests that fail, 0 to 1. */
  failureRate: number;
  /** HTTP status used for failures. */
  failStatus: number;
}

interface InstanceState extends InstanceSettings {
  requests: number;
  failures: number;
}

interface ChatBody {
  messages?: { role: string; content: string }[];
  max_tokens?: number;
}

const tokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

/**
 * A stand-in LLM provider for tests and load tests. Its delay and failure rate
 * change at runtime through /control, so a test can make a provider slow or
 * break it halfway through a run.
 */
export function createMockServer(defaults: InstanceSettings, random: () => number = Math.random) {
  const instances = new Map<string, InstanceState>();
  const state = (name: string): InstanceState => {
    let s = instances.get(name);
    if (!s) {
      s = { ...defaults, requests: 0, failures: 0 };
      instances.set(name, s);
    }
    return s;
  };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/control', (_req, res) => {
    res.json({ defaults, instances: Object.fromEntries(instances) });
  });

  app.post('/control/reset', (_req, res) => {
    instances.clear();
    res.json({ ok: true });
  });

  app.post('/control/:instance', (req: Request<{ instance: string }>, res) => {
    const s = state(req.params.instance);
    const body = (req.body ?? {}) as Partial<InstanceSettings>;
    for (const field of ['delayMs', 'jitterMs', 'failureRate', 'failStatus'] as const) {
      const value = body[field];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) s[field] = value;
    }
    s.failureRate = Math.min(1, s.failureRate);
    res.json({ instance: req.params.instance, ...s });
  });

  app.get('/:instance/health', (req: Request<{ instance: string }>, res) => {
    const s = state(req.params.instance);
    res
      .status(s.failureRate >= 1 ? s.failStatus : 200)
      .json({ status: s.failureRate >= 1 ? 'down' : 'ok' });
  });

  app.post('/:instance/v1/chat', (req: Request<{ instance: string }>, res: Response) => {
    const name = req.params.instance;
    const s = state(name);
    s.requests++;
    const body = (req.body ?? {}) as ChatBody;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const fail = random() < s.failureRate;
    const delay = s.delayMs + (s.jitterMs ? Math.floor(random() * s.jitterMs) : 0);

    const timer = setTimeout(() => {
      if (fail) {
        s.failures++;
        res.status(s.failStatus).json({ error: { message: `mock ${name} failure` } });
        return;
      }
      const prompt = messages.map((m) => m.content).join('\n');
      const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      let text = `Mock answer from ${name} to: "${lastUser.slice(0, 80)}"`;
      const maxTokens = Number(body.max_tokens) || 512;
      if (tokens(text) > maxTokens) text = text.slice(0, maxTokens * 4);
      res.json({ text, usage: { input_tokens: tokens(prompt), output_tokens: tokens(text) } });
    }, delay);

    // The gateway gave up (timeout): stop working on this request.
    res.on('close', () => clearTimeout(timer));
  });

  return { app, state };
}
