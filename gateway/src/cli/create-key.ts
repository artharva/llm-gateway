/**
 * Mint an API key from the command line:
 *   npm run create-key -- --name chatbot --owner atharva --rate 60 --budget 1000000
 */
import { parseArgs } from 'node:util';
import { loadEnv } from '../config/env';
import { PgKeyStore } from '../db/keyStore';
import { migrate } from '../db/migrate';
import { createPool } from '../db/pool';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      owner: { type: 'string' },
      rate: { type: 'string' },
      burst: { type: 'string' },
      budget: { type: 'string' },
    },
  });
  if (!values.name) {
    console.error(
      'Usage: npm run create-key -- --name <name> [--owner x] [--rate 60] [--burst 60] [--budget 1000000]',
    );
    process.exit(2);
  }
  const pool = createPool(loadEnv().DATABASE_URL);
  try {
    await migrate(pool);
    const { record, key } = await new PgKeyStore(pool).create({
      name: values.name,
      owner: values.owner ?? null,
      ratePerMin: values.rate ? Number(values.rate) : undefined,
      burst: values.burst ? Number(values.burst) : undefined,
      monthlyTokenBudget: values.budget ? Number(values.budget) : undefined,
    });
    console.log(
      `Created key #${record.id} "${record.name}" (${record.ratePerMin}/min, ${record.monthlyTokenBudget} tokens/month)`,
    );
    console.log(`\n  ${key}\n\nStore it now: only its hash is saved, so it cannot be shown again.`);
  } finally {
    await pool.end();
  }
}

void main();
