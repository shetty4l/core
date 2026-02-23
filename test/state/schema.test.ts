/**
 * Tests for schema management.
 */

import { describe, expect, test } from "bun:test";
import { ensureTable, migrateAdditive } from "../../src/state/schema";
import type { ClassMeta } from "../../src/state/types";
import { createTestDb, getColumns } from "./helpers";

describe("ensureTable", () => {
  test("creates table with correct name", () => {
    const db = createTestDb();
    const meta: ClassMeta = { table: "my_state", fields: new Map() };

    ensureTable(db, meta);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("my_state");
  });

  test("creates key column as TEXT PRIMARY KEY", () => {
    const db = createTestDb();
    const meta: ClassMeta = { table: "key_test", fields: new Map() };

    ensureTable(db, meta);

    const info = db.prepare("PRAGMA table_info(key_test)").all() as {
      name: string;
      type: string;
      pk: number;
    }[];
    const keyCol = info.find((c) => c.name === "key");
    expect(keyCol).toBeDefined();
    expect(keyCol!.type).toBe("TEXT");
    expect(keyCol!.pk).toBe(1);
  });

  test("creates updated_at column", () => {
    const db = createTestDb();
    const meta: ClassMeta = { table: "updated_test", fields: new Map() };

    ensureTable(db, meta);

    const columns = getColumns(db, "updated_test");
    expect(columns).toContain("updated_at");
  });

  test("creates columns for all @Field properties", () => {
    const db = createTestDb();
    const meta: ClassMeta = {
      table: "fields_test",
      fields: new Map([
        ["name", { property: "name", column: "name", type: "string" }],
        ["count", { property: "count", column: "count", type: "number" }],
        [
          "enabled",
          { property: "enabled", column: "enabled", type: "boolean" },
        ],
      ]),
    };

    ensureTable(db, meta);

    const columns = getColumns(db, "fields_test");
    expect(columns).toContain("name");
    expect(columns).toContain("count");
    expect(columns).toContain("enabled");
  });

  test("uses snake_case column names", () => {
    const db = createTestDb();
    const meta: ClassMeta = {
      table: "snake_test",
      fields: new Map([
        [
          "myField",
          { property: "myField", column: "my_field", type: "string" },
        ],
      ]),
    };

    ensureTable(db, meta);

    const columns = getColumns(db, "snake_test");
    expect(columns).toContain("my_field");
  });

  test("maps types correctly", () => {
    const db = createTestDb();
    const meta: ClassMeta = {
      table: "types_test",
      fields: new Map([
        ["str", { property: "str", column: "str", type: "string" }],
        ["num", { property: "num", column: "num", type: "number" }],
        ["bool", { property: "bool", column: "bool", type: "boolean" }],
        ["dt", { property: "dt", column: "dt", type: "date" }],
      ]),
    };

    ensureTable(db, meta);

    const info = db.prepare("PRAGMA table_info(types_test)").all() as {
      name: string;
      type: string;
    }[];

    expect(info.find((c) => c.name === "str")!.type).toBe("TEXT");
    expect(info.find((c) => c.name === "num")!.type).toBe("REAL");
    expect(info.find((c) => c.name === "bool")!.type).toBe("INTEGER");
    expect(info.find((c) => c.name === "dt")!.type).toBe("TEXT");
  });

  test("is idempotent", () => {
    const db = createTestDb();
    const meta: ClassMeta = {
      table: "idem_test",
      fields: new Map([
        ["value", { property: "value", column: "value", type: "string" }],
      ]),
    };

    // Insert data
    ensureTable(db, meta);
    db.prepare("INSERT INTO idem_test (key, value) VALUES (?, ?)").run(
      "k1",
      "v1",
    );

    // Call again
    ensureTable(db, meta);

    // Data should still exist
    const row = db.prepare("SELECT * FROM idem_test WHERE key = ?").get("k1");
    expect(row).toBeDefined();
  });

  test("empty class creates table with just key + updated_at", () => {
    const db = createTestDb();
    const meta: ClassMeta = { table: "empty_test", fields: new Map() };

    ensureTable(db, meta);

    const columns = getColumns(db, "empty_test");
    expect(columns).toEqual(["key", "updated_at"]);
  });
});

describe("migrateAdditive", () => {
  test("adds missing columns", () => {
    const db = createTestDb();

    // Create table with one field
    const meta1: ClassMeta = {
      table: "migrate_test",
      fields: new Map([
        ["name", { property: "name", column: "name", type: "string" }],
      ]),
    };
    ensureTable(db, meta1);

    // Add another field
    const meta2: ClassMeta = {
      table: "migrate_test",
      fields: new Map([
        ["name", { property: "name", column: "name", type: "string" }],
        ["count", { property: "count", column: "count", type: "number" }],
      ]),
    };
    migrateAdditive(db, meta2);

    const columns = getColumns(db, "migrate_test");
    expect(columns).toContain("count");
  });

  test("preserves existing columns", () => {
    const db = createTestDb();

    const meta: ClassMeta = {
      table: "preserve_test",
      fields: new Map([
        ["name", { property: "name", column: "name", type: "string" }],
      ]),
    };
    ensureTable(db, meta);

    // Migrate with same fields
    migrateAdditive(db, meta);

    const columns = getColumns(db, "preserve_test");
    expect(columns).toContain("name");
  });

  test("preserves existing data", () => {
    const db = createTestDb();

    // Create with one field
    const meta1: ClassMeta = {
      table: "data_test",
      fields: new Map([
        ["name", { property: "name", column: "name", type: "string" }],
      ]),
    };
    ensureTable(db, meta1);
    db.prepare("INSERT INTO data_test (key, name) VALUES (?, ?)").run(
      "k1",
      "Alice",
    );

    // Add field and migrate
    const meta2: ClassMeta = {
      table: "data_test",
      fields: new Map([
        ["name", { property: "name", column: "name", type: "string" }],
        ["age", { property: "age", column: "age", type: "number" }],
      ]),
    };
    migrateAdditive(db, meta2);

    // Check original data preserved
    const row = db
      .prepare("SELECT * FROM data_test WHERE key = ?")
      .get("k1") as Record<string, unknown>;
    expect(row.name).toBe("Alice");
  });

  test("handles multiple new columns", () => {
    const db = createTestDb();

    const meta1: ClassMeta = { table: "multi_new_test", fields: new Map() };
    ensureTable(db, meta1);

    const meta2: ClassMeta = {
      table: "multi_new_test",
      fields: new Map([
        ["a", { property: "a", column: "a", type: "string" }],
        ["b", { property: "b", column: "b", type: "number" }],
        ["c", { property: "c", column: "c", type: "boolean" }],
      ]),
    };
    migrateAdditive(db, meta2);

    const columns = getColumns(db, "multi_new_test");
    expect(columns).toContain("a");
    expect(columns).toContain("b");
    expect(columns).toContain("c");
  });

  test("is idempotent", () => {
    const db = createTestDb();

    const meta: ClassMeta = {
      table: "idem_migrate_test",
      fields: new Map([
        ["value", { property: "value", column: "value", type: "string" }],
      ]),
    };
    ensureTable(db, meta);

    // Call multiple times
    migrateAdditive(db, meta);
    migrateAdditive(db, meta);
    migrateAdditive(db, meta);

    // Should not throw, columns should exist once
    const columns = getColumns(db, "idem_migrate_test");
    const valueCount = columns.filter((c) => c === "value").length;
    expect(valueCount).toBe(1);
  });

  test("does NOT remove columns not in metadata", () => {
    const db = createTestDb();

    // Create with two fields
    const meta1: ClassMeta = {
      table: "no_remove_test",
      fields: new Map([
        ["keep", { property: "keep", column: "keep", type: "string" }],
        ["remove", { property: "remove", column: "remove", type: "string" }],
      ]),
    };
    ensureTable(db, meta1);

    // Migrate with only one field
    const meta2: ClassMeta = {
      table: "no_remove_test",
      fields: new Map([
        ["keep", { property: "keep", column: "keep", type: "string" }],
      ]),
    };
    migrateAdditive(db, meta2);

    // "remove" column should still exist
    const columns = getColumns(db, "no_remove_test");
    expect(columns).toContain("remove");
  });

  test("adds updated_at if missing", () => {
    const db = createTestDb();

    // Create table manually without updated_at
    db.exec("CREATE TABLE manual_test (key TEXT PRIMARY KEY)");

    const meta: ClassMeta = { table: "manual_test", fields: new Map() };
    migrateAdditive(db, meta);

    const columns = getColumns(db, "manual_test");
    expect(columns).toContain("updated_at");
  });
});
