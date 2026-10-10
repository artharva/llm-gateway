import { z } from 'zod';

const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/gateway'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  GATEWAY_CONFIG: z.string().default('config/gateway.json'),
  ADMIN_TOKEN: z.string().min(8, 'ADMIN_TOKEN must be at least 8 characters').optional(),
  LOG_LEVEL: z.string().default('info'),
  LOG_PROMPTS: flag,
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
