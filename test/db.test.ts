import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { createDatabaseManager } from "../src/db";

const TMP = join(import.meta.dir, ".tmp-db");

afterEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
});

describe("createDatabaseManager", () => {
  test("init creates database and returns it", () => {
    const mgr = createDatabaseManager({ path: ":memory:" });
    const db = mgr.init();
    expect(db).toBeDefined();
    mgr.close();
  });

  test("db() returns initialized database", () => {
    const mgr = createDatabaseManager({ path: ":memory:" });
    const db = mgr.init();
    expect(mgr.db()).toBe(db);
    mgr.close();
  });

  test("db() throws before init", () => {
    const mgr = createDatabaseManager({ path: ":memory:" });
    expect(() => mgr.db()).toThrow(
      "Database not initialized. Call init() first.",
    );
  });

  test("init executes schema SQL", () => {
    const mgr = createDatabaseManager({
      path: ":memory:",
      schema: "CREATE TABLE test (id TEXT PRIMARY KEY, name TEXT)",
    });
    const db = mgr.init();

    const info = db.prepare("PRAGMA table_info(test)").all() as {
      name: string;
    }[];
    const columns = info.map((c) => c.name);
    expect(columns).toContain("id");
    expect(columns).toContain("name");
    mgr.close();
  });

  test("init calls migrate callback with the database", () => {
    let migrateCalled = false;
    let migrateDb: unknown = null;

    const mgr = createDatabaseManager({
      path: ":memory:",
      schema: "CREATE TABLE test (id TEXT PRIMARY KEY)",
      migrate: (db) => {
        migrateCalled = true;
        migrateDb = db;
        db.exec("ALTER TABLE test ADD COLUMN extra TEXT");
      },
    });
    const db = mgr.init();

    expect(migrateCalled).toBe(true);
    expect(migrateDb).toBe(db);

    const info = db.prepare("PRAGMA table_info(test)").all() as {
      name: string;
    }[];
    expect(info.map((c) => c.name)).toContain("extra");
    mgr.close();
  });

  test("init enables WAL mode for file paths", () => {
    mkdirSync(TMP, { recursive: true });
    const dbPath = join(TMP, "wal-test.db");
    const mgr = createDatabaseManager({ path: dbPath });
    const db = mgr.init();

    const result = db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    expect(result.journal_mode).toBe("wal");
    mgr.close();
  });

  test("init skips WAL for :memory:", () => {
    const mgr = createDatabaseManager({ path: ":memory:" });
    const db = mgr.init();

    const result = db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    expect(result.journal_mode).toBe("memory");
    mgr.close();
  });

  test("init is idempotent", () => {
    const mgr = createDatabaseManager({ path: ":memory:" });
    const db1 = mgr.init();
    const db2 = mgr.init();
    expect(db1).toBe(db2);
    mgr.close();
  });

  test("close clears the singleton", () => {
    const mgr = createDatabaseManager({ path: ":memory:" });
    mgr.init();
    mgr.close();
    expect(() => mgr.db()).toThrow(
      "Database not initialized. Call init() first.",
    );
  });

  test("reset clears without closing", () => {
    const mgr = createDatabaseManager({ path: ":memory:" });
    mgr.init();
    mgr.reset();
    expect(() => mgr.db()).toThrow(
      "Database not initialized. Call init() first.",
    );
  });

  test("pathOverride overrides opts.path", () => {
    const mgr = createDatabaseManager({ path: "/nonexistent/path/db.sqlite" });
    // pathOverride to :memory: avoids needing the nonexistent path
    const db = mgr.init(":memory:");
    expect(db).toBeDefined();
    mgr.close();
  });

  test("init creates parent directory for file paths", () => {
    const nested = join(TMP, "a", "b", "c");
    const dbPath = join(nested, "test.db");

    expect(existsSync(nested)).toBe(false);

    const mgr = createDatabaseManager({ path: dbPath });
    mgr.init();

    expect(existsSync(nested)).toBe(true);
    mgr.close();
  });

  test("init without schema or migrate works", () => {
    const mgr = createDatabaseManager({ path: ":memory:" });
    const db = mgr.init();
    // Should be able to use the raw database
    db.exec("CREATE TABLE raw (id INTEGER)");
    db.prepare("INSERT INTO raw VALUES (1)").run();
    const row = db.prepare("SELECT id FROM raw").get() as { id: number };
    expect(row.id).toBe(1);
    mgr.close();
  });
});
