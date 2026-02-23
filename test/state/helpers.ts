/**
 * Test helpers for state persistence tests.
 */

import { Database } from "bun:sqlite";

/**
 * Create an in-memory database for testing.
 */
export function createTestDb(): Database {
  return new Database(":memory:");
}

/**
 * Get all rows from a table.
 */
export function getAllRows(
  db: Database,
  table: string,
): Record<string, unknown>[] {
  return db.prepare(`SELECT * FROM ${table}`).all() as Record<
    string,
    unknown
  >[];
}

/**
 * Get a single row by key.
 */
export function getRow(
  db: Database,
  table: string,
  key: string,
): Record<string, unknown> | null {
  return db.prepare(`SELECT * FROM ${table} WHERE key = ?`).get(key) as Record<
    string,
    unknown
  > | null;
}

/**
 * Get column info for a table.
 */
export function getColumns(db: Database, table: string): string[] {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return info.map((row) => row.name);
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
