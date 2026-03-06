/**
 * Integration tests for PostgreSQL database setup + migrations.
 *
 * Requires a running PostgreSQL instance (docker compose up -d postgres).
 * Creates a temporary database ki_assistent_test, runs all migrations,
 * verifies the schema, then drops the database on teardown.
 *
 * Run:
 *   docker compose up -d postgres
 *   cd packages/gateway && pnpm vitest run src/database/__tests__/database.test.ts
 *   docker compose down
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { runMigrations } from '../migrate.js';

const { Client, Pool } = pg;

const TEST_DB = 'ki_assistent_test';
const PG_USER = process.env['PGUSER'] ?? 'ki_assistent';
const PG_PASSWORD = process.env['PGPASSWORD'] ?? process.env['POSTGRES_PASSWORD'] ?? 'testpass';
const PG_HOST = process.env['PGHOST'] ?? '127.0.0.1';
const PG_PORT = Number(process.env['PGPORT'] ?? '5432');

/** Admin connection (to default DB) for creating/dropping the test database. */
function adminConnectionString(): string {
  return `postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/postgres`;
}

/** Connection string pointing at the test database. */
function testConnectionString(): string {
  return `postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${TEST_DB}`;
}

let pool: Pool;

beforeAll(async () => {
  // 1. Create the test database (drop first if it exists from a previous failed run)
  const admin = new Client({ connectionString: adminConnectionString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }

  // 2. Create a pool for the test database
  pool = new Pool({
    connectionString: testConnectionString(),
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
}, 30000);

afterAll(async () => {
  // 1. Close the pool
  if (pool) {
    await pool.end();
  }

  // 2. Drop the test database
  const admin = new Client({ connectionString: adminConnectionString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  } finally {
    await admin.end();
  }
}, 15000);

// ── Expected tables from 001_initial.sql ──────────────────────────────
const EXPECTED_TABLES = [
  'users',
  'user_settings',
  'user_oauth_tokens',
  'user_api_keys',
  'token_usage',
  'user_budget_limits',
  'sessions',
  'messages',
  'notes',
  'reminders',
] as const;

describe('Database integration', () => {
  // ── Migration ─────────────────────────────────────────────────────
  it('runs migrations without error on an empty database', async () => {
    await expect(runMigrations(pool)).resolves.toBeUndefined();
  });

  it('is idempotent — running migrations twice causes no error', async () => {
    await expect(runMigrations(pool)).resolves.toBeUndefined();
  });

  // ── Schema verification ───────────────────────────────────────────
  it('creates all 10 expected tables', async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_migrations'`,
    );
    const tables = rows.map((r) => r.tablename).sort();
    const expected = [...EXPECTED_TABLES].sort();
    expect(tables).toEqual(expected);
  });

  // ── Basic CRUD ────────────────────────────────────────────────────
  it('inserts and selects a user', async () => {
    const { rows } = await pool.query<{ id: string; clerk_id: string; email: string; tier: string }>(
      `INSERT INTO users (clerk_id, email, name, tier)
       VALUES ($1, $2, $3, $4)
       RETURNING id, clerk_id, email, tier`,
      ['clerk_test_001', 'test@example.com', 'Test User', 'free'],
    );
    expect(rows).toHaveLength(1);
    const user = rows[0]!;
    expect(user.clerk_id).toBe('clerk_test_001');
    expect(user.email).toBe('test@example.com');
    expect(user.tier).toBe('free');
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  // ── CASCADE delete ────────────────────────────────────────────────
  it('cascades delete: removing a user deletes all dependent rows', async () => {
    // 1. Insert a user
    const { rows: userRows } = await pool.query<{ id: string }>(
      `INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id`,
      ['clerk_cascade_test', 'cascade@example.com'],
    );
    const userId = userRows[0]!.id;

    // 2. Insert dependent rows in all child tables
    await pool.query(
      `INSERT INTO user_settings (user_id) VALUES ($1)`,
      [userId],
    );
    await pool.query(
      `INSERT INTO user_oauth_tokens (user_id, provider, access_token_enc, refresh_token_enc)
       VALUES ($1, 'google', 'enc_access', 'enc_refresh')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO user_api_keys (user_id, provider, key_enc) VALUES ($1, 'openai', 'enc_key')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO token_usage (user_id, session_id, model, tier) VALUES ($1, 'sess1', 'gpt-4', 'free')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO user_budget_limits (user_id) VALUES ($1)`,
      [userId],
    );

    const { rows: sessionRows } = await pool.query<{ id: string }>(
      `INSERT INTO sessions (user_id, title) VALUES ($1, 'Test Session') RETURNING id`,
      [userId],
    );
    const sessionId = sessionRows[0]!.id;

    await pool.query(
      `INSERT INTO messages (session_id, role, content) VALUES ($1, 'user', 'Hello')`,
      [sessionId],
    );
    await pool.query(
      `INSERT INTO notes (user_id, title, content) VALUES ($1, 'Note', 'Content')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO reminders (user_id, text, datetime) VALUES ($1, 'Reminder', NOW())`,
      [userId],
    );

    // 3. Delete the user
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);

    // 4. Verify all dependent rows are gone
    const dependentTables = [
      'user_settings',
      'user_oauth_tokens',
      'user_api_keys',
      'token_usage',
      'user_budget_limits',
      'sessions',
      'notes',
      'reminders',
    ];

    for (const table of dependentTables) {
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${table} WHERE user_id = $1`, [userId]);
      expect(rows[0]!.cnt, `${table} should have 0 rows after CASCADE delete`).toBe(0);
    }

    // Messages cascade through sessions
    const { rows: msgRows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM messages WHERE session_id = $1`,
      [sessionId],
    );
    expect(msgRows[0]!.cnt, 'messages should cascade via sessions').toBe(0);
  });

  // ── Pool ──────────────────────────────────────────────────────────
  it('pool connection works (query returns result)', async () => {
    const { rows } = await pool.query<{ result: number }>('SELECT 1 AS result');
    expect(rows[0]!.result).toBe(1);
  });

  it('pool.end() cleans up without error', async () => {
    const tempPool = new Pool({
      connectionString: testConnectionString(),
      max: 2,
    });
    // Ensure at least one connection was opened
    await tempPool.query('SELECT 1');
    await expect(tempPool.end()).resolves.toBeUndefined();
  });
});
