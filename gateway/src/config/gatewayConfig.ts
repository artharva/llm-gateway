import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const providerSchema = z.object({
  type: z.enum(['groq', 'gemini', 'ollama', 'mock']),
  model: z.string().min(1),
  baseUrl: z.url(),
  /** Env var that overrides baseUrl, e.g. inside Docker Compose. */
  baseUrlEnv: z.string().optional(),
  /** Env var holding the API key. If it is set in config but empty, the provider is skipped. */
  apiKeyEnv: z.string().optional(),
});

const aliasSchema = z.object({
  chain: z.array(z.string()).min(1),
  /** priority: always try in order. round-robin: rotate the starting provider. */
  strategy: z.enum(['priority', 'round-robin']).default('priority'),
  timeoutMs: z.number().int().positive().default(15_000),
});

export const gatewayConfigSchema = z
  .object({
    providers: z.record(z.string(), providerSchema),
    aliases: z.record(z.string(), aliasSchema),
  })
  .superRefine((cfg, ctx) => {
    for (const [alias, { chain }] of Object.entries(cfg.aliases)) {
      for (const name of chain) {
        if (!cfg.providers[name]) {
          ctx.addIssue({
            code: 'custom',
            path: ['aliases', alias, 'chain'],
            message: `unknown provider "${name}"`,
          });
        }
      }
    }
  });

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;
export type ProviderConfig = z.infer<typeof providerSchema>;
export type AliasConfig = z.infer<typeof aliasSchema>;

/** Reads and validates the config file; a bad file stops the gateway at startup. */
export function loadGatewayConfig(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  const raw: unknown = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  return parseGatewayConfig(raw, env);
}

export function parseGatewayConfig(
  raw: unknown,
  env: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  const result = gatewayConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid gateway config:\n${z.prettifyError(result.error)}`);
  }
  const config = result.data;
  for (const provider of Object.values(config.providers)) {
    const override = provider.baseUrlEnv ? env[provider.baseUrlEnv] : undefined;
    if (override) provider.baseUrl = override;
    provider.baseUrl = provider.baseUrl.replace(/\/+$/, '');
  }
  return config;
}
