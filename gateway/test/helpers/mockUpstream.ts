import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

interface MockServerModule {
  createMockServer(defaults: {
    delayMs: number;
    jitterMs: number;
    failureRate: number;
    failStatus: number;
  }): {
    app: Express;
  };
}

/** Starts the real mock-provider app (from the sibling workspace) on a random port. */
export async function startMockUpstream(delayMs = 0) {
  // Loaded by path so the gateway's tsconfig does not need to include the other workspace.
  const modulePath = path.join(__dirname, '..', '..', '..', 'mock-provider', 'src', 'server');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createMockServer } = require(modulePath) as MockServerModule;
  const { app } = createMockServer({ delayMs, jitterMs: 0, failureRate: 0, failStatus: 503 });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    control: async (instance: string, settings: Record<string, number>) => {
      await fetch(`${url}/control/${instance}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      });
    },
    stats: async () =>
      (
        (await (await fetch(`${url}/control`)).json()) as {
          instances: Record<string, { requests: number }>;
        }
      ).instances,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
