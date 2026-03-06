/**
 * Minimal migration runner for PostgreSQL.
 * Numbered SQL files in migrations/ + _migrations tracking table.
 * Called at gateway startup BEFORE all other modules.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

export async function runMigrations(pool: Pool): Promise<void> {
  // 1. Ensure _migrations tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 2. Read all .sql files from migrations dir, sorted alphabetically
  let files: string[];
  try {
    const entries = await readdir(MIGRATIONS_DIR);
    files = entries.filter((f) => f.endsWith('.sql')).sort();
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('[migrate] No migrations directory found, skipping');
      return;
    }
    throw err;
  }

  if (files.length === 0) {
    console.log('[migrate] No migration files found');
    return;
  }

  // 3. Query already applied migrations
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM _migrations');
  const applied = new Set(rows.map((r) => r.name));

  // 4. Run each pending migration in its own transaction
  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('[migrate] All migrations already applied');
    return;
  }

  for (const file of pending) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = await readFile(filePath, 'utf-8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] Applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migrate] Failed: ${file}`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(`[migrate] Done — ${String(pending.length)} migration(s) applied`);
}
