import type { Pool } from 'pg';
import { migrate } from '../../src/db/migrate';
import { createPool } from '../../src/db/pool';

/** A fresh schema for each test file: drops everything, then migrates. */
export async function freshDatabase(): Promise<Pool> {
  const pool = createPool(process.env.DATABASE_URL!);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  return pool;
}
