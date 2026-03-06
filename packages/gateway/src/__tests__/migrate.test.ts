import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";

// Mock node:fs/promises
vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

import { readdir, readFile } from "node:fs/promises";
import { runMigrations } from "../database/migrate.js";

function createMockClient(): PoolClient {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  } as unknown as PoolClient;
}

function createMockPool(
  appliedMigrations: string[] = [],
): { pool: Pool; client: PoolClient } {
  const client = createMockClient();
  const pool = {
    query: vi.fn().mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("SELECT name FROM _migrations")) {
        return Promise.resolve({
          rows: appliedMigrations.map((name) => ({ name })),
        } as QueryResult);
      }
      return Promise.resolve({ rows: [] } as QueryResult);
    }),
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
  return { pool, client };
}

describe("runMigrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates _migrations table on first run", async () => {
    vi.mocked(readdir).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
    const { pool } = createMockPool();

    await runMigrations(pool);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS _migrations"),
    );
  });

  it("skips gracefully when migrations directory does not exist", async () => {
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    vi.mocked(readdir).mockRejectedValue(enoent);
    const { pool } = createMockPool();

    await expect(runMigrations(pool)).resolves.toBeUndefined();
  });

  it("re-throws non-ENOENT filesystem errors", async () => {
    const eperm = Object.assign(new Error("EPERM"), { code: "EPERM" });
    vi.mocked(readdir).mockRejectedValue(eperm);
    const { pool } = createMockPool();

    await expect(runMigrations(pool)).rejects.toThrow("EPERM");
  });

  it("skips non-.sql files", async () => {
    vi.mocked(readdir).mockResolvedValue(
      ["README.md", ".gitkeep"] as unknown as Awaited<ReturnType<typeof readdir>>,
    );
    const { pool } = createMockPool();

    await runMigrations(pool);

    // Only CREATE TABLE + no SELECT (no .sql files found)
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("applies pending migrations in alphabetical order", async () => {
    vi.mocked(readdir).mockResolvedValue(
      ["002_users.sql", "001_init.sql"] as unknown as Awaited<ReturnType<typeof readdir>>,
    );
    vi.mocked(readFile).mockImplementation((filePath) => {
      const name = String(filePath);
      if (name.includes("001_init")) return Promise.resolve("CREATE TABLE t1 (id INT)");
      if (name.includes("002_users")) return Promise.resolve("CREATE TABLE t2 (id INT)");
      return Promise.resolve("");
    });
    const { pool, client } = createMockPool();

    await runMigrations(pool);

    const clientCalls = vi.mocked(client.query).mock.calls.map((c) => c[0]);

    // First migration: BEGIN, SQL, INSERT, COMMIT
    expect(clientCalls[0]).toBe("BEGIN");
    expect(clientCalls[1]).toBe("CREATE TABLE t1 (id INT)");
    expect(clientCalls[2]).toBe("INSERT INTO _migrations (name) VALUES ($1)");
    expect(clientCalls[3]).toBe("COMMIT");

    // Second migration
    expect(clientCalls[4]).toBe("BEGIN");
    expect(clientCalls[5]).toBe("CREATE TABLE t2 (id INT)");
    expect(clientCalls[6]).toBe("INSERT INTO _migrations (name) VALUES ($1)");
    expect(clientCalls[7]).toBe("COMMIT");

    // Verify alphabetical order via INSERT params
    const insertParams = vi.mocked(client.query).mock.calls
      .filter((c) => String(c[0]).includes("INSERT"))
      .map((c) => (c[1] as string[])[0]);
    expect(insertParams).toEqual(["001_init.sql", "002_users.sql"]);
  });

  it("skips already applied migrations", async () => {
    vi.mocked(readdir).mockResolvedValue(
      ["001_init.sql", "002_users.sql"] as unknown as Awaited<ReturnType<typeof readdir>>,
    );
    vi.mocked(readFile).mockResolvedValue("CREATE TABLE t2 (id INT)");
    const { pool, client } = createMockPool(["001_init.sql"]);

    await runMigrations(pool);

    // Only one migration applied (002_users.sql)
    expect(pool.connect).toHaveBeenCalledTimes(1);
    const insertCalls = vi.mocked(client.query).mock.calls
      .filter((c) => String(c[0]).includes("INSERT"));
    expect(insertCalls).toHaveLength(1);
    expect((insertCalls[0]![1] as string[])[0]).toBe("002_users.sql");
  });

  it("rolls back and re-throws on migration failure", async () => {
    vi.mocked(readdir).mockResolvedValue(
      ["001_bad.sql"] as unknown as Awaited<ReturnType<typeof readdir>>,
    );
    vi.mocked(readFile).mockResolvedValue("INVALID SQL");
    const { pool, client } = createMockPool();

    // Make the SQL execution fail
    const sqlError = new Error("syntax error");
    vi.mocked(client.query).mockImplementation((sql: string) => {
      if (sql === "INVALID SQL") return Promise.reject(sqlError);
      return Promise.resolve({ rows: [] } as QueryResult);
    });

    await expect(runMigrations(pool)).rejects.toThrow("syntax error");

    const clientCalls = vi.mocked(client.query).mock.calls.map((c) => c[0]);
    expect(clientCalls).toContain("ROLLBACK");
    expect(clientCalls).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });

  it("releases client even on error", async () => {
    vi.mocked(readdir).mockResolvedValue(
      ["001_fail.sql"] as unknown as Awaited<ReturnType<typeof readdir>>,
    );
    vi.mocked(readFile).mockResolvedValue("BAD");
    const { pool, client } = createMockPool();

    vi.mocked(client.query).mockImplementation((sql: string) => {
      if (sql === "BAD") return Promise.reject(new Error("fail"));
      return Promise.resolve({ rows: [] } as QueryResult);
    });

    await expect(runMigrations(pool)).rejects.toThrow("fail");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("does nothing when all migrations are already applied", async () => {
    vi.mocked(readdir).mockResolvedValue(
      ["001_init.sql"] as unknown as Awaited<ReturnType<typeof readdir>>,
    );
    const { pool } = createMockPool(["001_init.sql"]);

    await runMigrations(pool);

    expect(pool.connect).not.toHaveBeenCalled();
  });

  // Security: SQL file content is executed via parameterized client, not string interpolation
  it("migration name is inserted via parameterized query (no SQL injection)", async () => {
    vi.mocked(readdir).mockResolvedValue(
      ["001_init.sql"] as unknown as Awaited<ReturnType<typeof readdir>>,
    );
    vi.mocked(readFile).mockResolvedValue("SELECT 1");
    const { pool, client } = createMockPool();

    await runMigrations(pool);

    const insertCall = vi.mocked(client.query).mock.calls
      .find((c) => String(c[0]).includes("INSERT INTO _migrations"));
    expect(insertCall).toBeDefined();
    // Uses $1 parameterized query
    expect(insertCall![0]).toContain("$1");
    expect(insertCall![1]).toEqual(["001_init.sql"]);
  });
});
