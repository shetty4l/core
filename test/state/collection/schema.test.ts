/**
 * Tests for collection schema management: ensureCollectionTable(), ensureIndices(), migrateCollectionAdditive().
 */

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CollectionMeta } from "../../../src/state/collection/types";
import {
  ensureCollectionTable,
  ensureIndices,
  migrateCollectionAdditive,
} from "../../../src/state/schema";
import { createTestDb, getColumns } from "../helpers";

let db: Database;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

// Test metadata fixture
function createTestMeta(overrides?: Partial<CollectionMeta>): CollectionMeta {
  return {
    table: "test_collection",
    idProperty: "id",
    idColumn: "id",
    idType: "string",
    fields: new Map([
      ["name", { property: "name", column: "name", type: "string" }],
      ["age", { property: "age", column: "age", type: "number" }],
    ]),
    indices: [],
    ...overrides,
  };
}

describe("ensureCollectionTable", () => {
  test("creates table with correct name", () => {
    const meta = createTestMeta({ table: "my_collection" });
    ensureCollectionTable(db, meta);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("my_collection");
  });

  test("creates id column as PRIMARY KEY", () => {
    const meta = createTestMeta();
    ensureCollectionTable(db, meta);

    const info = db.prepare("PRAGMA table_info(test_collection)").all() as {
      name: string;
      type: string;
      pk: number;
    }[];
    const idCol = info.find((c) => c.name === "id");
    expect(idCol).toBeDefined();
    expect(idCol!.pk).toBe(1);
  });

  test("id column type matches idType (string -> TEXT)", () => {
    const meta = createTestMeta({ idType: "string" });
    ensureCollectionTable(db, meta);

    const info = db.prepare("PRAGMA table_info(test_collection)").all() as {
      name: string;
      type: string;
    }[];
    const idCol = info.find((c) => c.name === "id");
    expect(idCol!.type).toBe("TEXT");
  });

  test("id column type matches idType (number -> REAL)", () => {
    const meta = createTestMeta({ idType: "number", idColumn: "num_id" });
    ensureCollectionTable(db, meta);

    const info = db.prepare("PRAGMA table_info(test_collection)").all() as {
      name: string;
      type: string;
    }[];
    const idCol = info.find((c) => c.name === "num_id");
    expect(idCol!.type).toBe("REAL");
  });

  test("creates created_at and updated_at columns", () => {
    const meta = createTestMeta();
    ensureCollectionTable(db, meta);

    const columns = getColumns(db, "test_collection");
    expect(columns).toContain("created_at");
    expect(columns).toContain("updated_at");
  });

  test("creates columns for all @Field properties", () => {
    const meta = createTestMeta();
    ensureCollectionTable(db, meta);

    const columns = getColumns(db, "test_collection");
    expect(columns).toContain("name");
    expect(columns).toContain("age");
  });

  test("maps field types correctly", () => {
    const meta = createTestMeta({
      fields: new Map([
        ["str", { property: "str", column: "str", type: "string" }],
        ["num", { property: "num", column: "num", type: "number" }],
        ["bool", { property: "bool", column: "bool", type: "boolean" }],
        ["dt", { property: "dt", column: "dt", type: "date" }],
      ]),
    });
    ensureCollectionTable(db, meta);

    const info = db.prepare("PRAGMA table_info(test_collection)").all() as {
      name: string;
      type: string;
    }[];

    expect(info.find((c) => c.name === "str")!.type).toBe("TEXT");
    expect(info.find((c) => c.name === "num")!.type).toBe("REAL");
    expect(info.find((c) => c.name === "bool")!.type).toBe("INTEGER");
    expect(info.find((c) => c.name === "dt")!.type).toBe("TEXT");
  });

  test("is idempotent", () => {
    const meta = createTestMeta();

    // Create table and insert data
    ensureCollectionTable(db, meta);
    db.prepare(
      "INSERT INTO test_collection (id, name, age) VALUES (?, ?, ?)",
    ).run("k1", "Alice", 30);

    // Call again
    ensureCollectionTable(db, meta);

    // Data should still exist
    const row = db
      .prepare("SELECT * FROM test_collection WHERE id = ?")
      .get("k1");
    expect(row).toBeDefined();
  });
});

describe("ensureIndices", () => {
  test("creates single column index", () => {
    const meta = createTestMeta({
      indices: [{ columns: ["name"] }],
    });
    ensureCollectionTable(db, meta);
    ensureIndices(db, meta);

    const indices = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='test_collection'",
      )
      .all() as { name: string }[];
    expect(indices.map((i) => i.name)).toContain("test_collection_idx_name");
  });

  test("creates composite index", () => {
    const meta = createTestMeta({
      indices: [{ columns: ["name", "age"] }],
    });
    ensureCollectionTable(db, meta);
    ensureIndices(db, meta);

    const indices = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='test_collection'",
      )
      .all() as { name: string }[];
    expect(indices.map((i) => i.name)).toContain(
      "test_collection_idx_name_age",
    );
  });

  test("creates multiple indices", () => {
    const meta = createTestMeta({
      indices: [{ columns: ["name"] }, { columns: ["age"] }],
    });
    ensureCollectionTable(db, meta);
    ensureIndices(db, meta);

    const indices = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='test_collection'",
      )
      .all() as { name: string }[];
    expect(indices.map((i) => i.name)).toContain("test_collection_idx_name");
    expect(indices.map((i) => i.name)).toContain("test_collection_idx_age");
  });

  test("is idempotent", () => {
    const meta = createTestMeta({
      indices: [{ columns: ["name"] }],
    });
    ensureCollectionTable(db, meta);

    // Call multiple times
    ensureIndices(db, meta);
    ensureIndices(db, meta);
    ensureIndices(db, meta);

    const indices = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='test_collection'",
      )
      .all() as { name: string }[];
    const nameIdxCount = indices.filter(
      (i) => i.name === "test_collection_idx_name",
    ).length;
    expect(nameIdxCount).toBe(1);
  });
});

describe("migrateCollectionAdditive", () => {
  test("adds missing field columns", () => {
    // Create table with minimal fields
    const meta1 = createTestMeta({
      fields: new Map([
        ["name", { property: "name", column: "name", type: "string" }],
      ]),
    });
    ensureCollectionTable(db, meta1);

    // Migrate with additional field
    const meta2 = createTestMeta({
      fields: new Map([
        ["name", { property: "name", column: "name", type: "string" }],
        ["email", { property: "email", column: "email", type: "string" }],
      ]),
    });
    migrateCollectionAdditive(db, meta2);

    const columns = getColumns(db, "test_collection");
    expect(columns).toContain("email");
  });

  test("preserves existing data", () => {
    const meta1 = createTestMeta();
    ensureCollectionTable(db, meta1);
    db.prepare(
      "INSERT INTO test_collection (id, name, age) VALUES (?, ?, ?)",
    ).run("k1", "Alice", 30);

    // Add new field
    const meta2 = createTestMeta({
      fields: new Map([
        ["name", { property: "name", column: "name", type: "string" }],
        ["age", { property: "age", column: "age", type: "number" }],
        ["email", { property: "email", column: "email", type: "string" }],
      ]),
    });
    migrateCollectionAdditive(db, meta2);

    const row = db
      .prepare("SELECT * FROM test_collection WHERE id = ?")
      .get("k1") as Record<string, unknown>;
    expect(row.name).toBe("Alice");
    expect(row.age).toBe(30);
  });

  test("adds created_at if missing", () => {
    // Create table manually without created_at
    db.exec("CREATE TABLE manual_coll (id TEXT PRIMARY KEY, name TEXT)");

    const meta = createTestMeta({ table: "manual_coll" });
    migrateCollectionAdditive(db, meta);

    const columns = getColumns(db, "manual_coll");
    expect(columns).toContain("created_at");
  });

  test("adds updated_at if missing", () => {
    // Create table manually without updated_at
    db.exec("CREATE TABLE manual_coll2 (id TEXT PRIMARY KEY, name TEXT)");

    const meta = createTestMeta({ table: "manual_coll2" });
    migrateCollectionAdditive(db, meta);

    const columns = getColumns(db, "manual_coll2");
    expect(columns).toContain("updated_at");
  });

  test("does NOT remove columns not in metadata", () => {
    // Create with extra column
    const meta1 = createTestMeta({
      fields: new Map([
        ["name", { property: "name", column: "name", type: "string" }],
        ["extra", { property: "extra", column: "extra", type: "string" }],
      ]),
    });
    ensureCollectionTable(db, meta1);

    // Migrate without extra field
    const meta2 = createTestMeta({
      fields: new Map([
        ["name", { property: "name", column: "name", type: "string" }],
      ]),
    });
    migrateCollectionAdditive(db, meta2);

    // Extra column should still exist
    const columns = getColumns(db, "test_collection");
    expect(columns).toContain("extra");
  });

  test("is idempotent", () => {
    const meta = createTestMeta();
    ensureCollectionTable(db, meta);

    // Call multiple times
    migrateCollectionAdditive(db, meta);
    migrateCollectionAdditive(db, meta);
    migrateCollectionAdditive(db, meta);

    // Should not throw, columns should exist once
    const columns = getColumns(db, "test_collection");
    const nameCount = columns.filter((c) => c === "name").length;
    expect(nameCount).toBe(1);
  });
});
