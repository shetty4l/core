/**
 * Schema management for SQLite persistence.
 *
 * Handles table creation and additive schema migrations for both
 * singleton (@Persisted) and collection (@PersistedCollection) tables.
 */

import type { Database } from "bun:sqlite";
import type { CollectionMeta } from "./collection/types";
import { sqliteType } from "./serialization";
import type { ClassMeta } from "./types";

/**
 * Ensure a table exists for the given class metadata.
 *
 * Creates a table with:
 * - `key` TEXT PRIMARY KEY
 * - One column per @Field (snake_case names)
 * - `updated_at` TEXT for tracking modifications
 *
 * @param db - SQLite database instance
 * @param meta - Class metadata from @Persisted/@Field decorators
 */
export function ensureTable(db: Database, meta: ClassMeta): void {
  const columns: string[] = ["key TEXT PRIMARY KEY"];

  for (const field of meta.fields.values()) {
    const sqlType = sqliteType(field.type);
    columns.push(`${field.column} ${sqlType}`);
  }

  columns.push("updated_at TEXT");

  const sql = `CREATE TABLE IF NOT EXISTS ${meta.table} (${columns.join(", ")})`;
  db.exec(sql);
}

/**
 * Perform additive migration: add any missing columns.
 *
 * This function:
 * - Reads existing columns via PRAGMA table_info
 * - Adds columns for any @Field not yet in the table
 * - Never drops or modifies existing columns
 * - Is idempotent (safe to call multiple times)
 *
 * @param db - SQLite database instance
 * @param meta - Class metadata from @Persisted/@Field decorators
 */
export function migrateAdditive(db: Database, meta: ClassMeta): void {
  // Get existing columns
  const info = db.prepare(`PRAGMA table_info(${meta.table})`).all() as {
    name: string;
  }[];
  const existingColumns = new Set(info.map((row) => row.name));

  // Add missing columns
  for (const field of meta.fields.values()) {
    if (!existingColumns.has(field.column)) {
      const sqlType = sqliteType(field.type);
      db.exec(
        `ALTER TABLE ${meta.table} ADD COLUMN ${field.column} ${sqlType}`,
      );
    }
  }

  // Ensure updated_at exists
  if (!existingColumns.has("updated_at")) {
    db.exec(`ALTER TABLE ${meta.table} ADD COLUMN updated_at TEXT`);
  }
}

// --------------------------------------------------------------------------
// Collection schema functions
// --------------------------------------------------------------------------

/**
 * Ensure a collection table exists for the given collection metadata.
 *
 * Creates a table with:
 * - @Id field as PRIMARY KEY
 * - One column per @Field (snake_case names)
 * - `created_at` TEXT for tracking creation time
 * - `updated_at` TEXT for tracking modifications
 *
 * @param db - SQLite database instance
 * @param meta - Collection metadata from @PersistedCollection decorators
 */
export function ensureCollectionTable(
  db: Database,
  meta: CollectionMeta,
): void {
  // Start with primary key column
  const idSqlType = sqliteType(meta.idType);
  const columns: string[] = [`${meta.idColumn} ${idSqlType} PRIMARY KEY`];

  // Add all field columns
  for (const field of meta.fields.values()) {
    const fieldSqlType = sqliteType(field.type);
    columns.push(`${field.column} ${fieldSqlType}`);
  }

  // Add auto-managed timestamp columns
  columns.push("created_at TEXT");
  columns.push("updated_at TEXT");

  const sql = `CREATE TABLE IF NOT EXISTS ${meta.table} (${columns.join(", ")})`;
  db.exec(sql);
}

/**
 * Create indices for a collection table.
 *
 * Creates indices as defined in the collection metadata:
 * - Index name format: {table}_idx_{col1}_{col2}_...
 * - Uses CREATE INDEX IF NOT EXISTS for idempotency
 *
 * @param db - SQLite database instance
 * @param meta - Collection metadata from @PersistedCollection decorators
 */
export function ensureIndices(db: Database, meta: CollectionMeta): void {
  for (const index of meta.indices) {
    const indexName = `${meta.table}_idx_${index.columns.join("_")}`;
    const columnList = index.columns.join(", ");
    const sql = `CREATE INDEX IF NOT EXISTS ${indexName} ON ${meta.table} (${columnList})`;
    db.exec(sql);
  }
}

/**
 * Perform additive migration for a collection table: add any missing columns.
 *
 * This function:
 * - Reads existing columns via PRAGMA table_info
 * - Adds columns for any @Field not yet in the table
 * - Ensures created_at and updated_at columns exist
 * - Never drops or modifies existing columns
 * - Is idempotent (safe to call multiple times)
 *
 * @param db - SQLite database instance
 * @param meta - Collection metadata from @PersistedCollection decorators
 */
export function migrateCollectionAdditive(
  db: Database,
  meta: CollectionMeta,
): void {
  // Get existing columns
  const info = db.prepare(`PRAGMA table_info(${meta.table})`).all() as {
    name: string;
  }[];
  const existingColumns = new Set(info.map((row) => row.name));

  // Add missing field columns
  for (const field of meta.fields.values()) {
    if (!existingColumns.has(field.column)) {
      const fieldSqlType = sqliteType(field.type);
      db.exec(
        `ALTER TABLE ${meta.table} ADD COLUMN ${field.column} ${fieldSqlType}`,
      );
    }
  }

  // Ensure created_at exists
  if (!existingColumns.has("created_at")) {
    db.exec(`ALTER TABLE ${meta.table} ADD COLUMN created_at TEXT`);
  }

  // Ensure updated_at exists
  if (!existingColumns.has("updated_at")) {
    db.exec(`ALTER TABLE ${meta.table} ADD COLUMN updated_at TEXT`);
  }
}
