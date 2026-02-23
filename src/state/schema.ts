/**
 * Schema management for SQLite persistence.
 *
 * Handles table creation and additive schema migrations.
 */

import type { Database } from "bun:sqlite";
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
