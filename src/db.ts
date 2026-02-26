/**
 * SQLite database lifecycle management.
 *
 * Provides a minimal singleton wrapper around bun:sqlite Database
 * with automatic directory creation, WAL mode, schema execution,
 * and optional migration callback.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export interface DatabaseOpts {
  /** Path to SQLite database file. Use ":memory:" for in-memory databases. */
  path: string;
  /** SQL to execute after opening (e.g. CREATE TABLE IF NOT EXISTS statements). */
  schema?: string;
  /** Optional callback for migrations after schema execution. */
  migrate?: (db: Database) => void;
}

export interface DatabaseManager {
  /** Get the database instance. Throws if not initialized. */
  db(): Database;
  /** Initialize the database. Idempotent — returns existing instance if already open. */
  init(pathOverride?: string): Database;
  /** Close the database connection and clear the singleton. */
  close(): void;
  /** Clear the singleton reference without closing (for tests). */
  reset(): void;
}

/**
 * Create a database manager with singleton lifecycle.
 *
 * Usage:
 * ```ts
 * const manager = createDatabaseManager({
 *   path: "~/.local/share/myapp/data.db",
 *   schema: "CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY)",
 *   migrate: (db) => { ... },
 * });
 *
 * manager.init();          // open + schema + migrate
 * const db = manager.db(); // get the instance
 * manager.close();         // cleanup
 * ```
 */
export function createDatabaseManager(opts: DatabaseOpts): DatabaseManager {
  let instance: Database | null = null;

  return {
    db(): Database {
      if (!instance) {
        throw new Error("Database not initialized. Call init() first.");
      }
      return instance;
    },

    init(pathOverride?: string): Database {
      if (instance) {
        return instance;
      }

      const path = pathOverride ?? opts.path;

      // Ensure parent directory exists for file-based databases
      if (path !== ":memory:") {
        const dir = dirname(path);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
      }

      const db = new Database(path);

      // Enable WAL mode for better concurrent access (not applicable to :memory:)
      if (path !== ":memory:") {
        db.exec("PRAGMA journal_mode = WAL;");
        db.exec("PRAGMA busy_timeout = 5000;");
      }

      // Execute schema SQL
      if (opts.schema) {
        db.exec(opts.schema);
      }

      // Run migrations
      if (opts.migrate) {
        opts.migrate(db);
      }

      instance = db;
      return db;
    },

    close(): void {
      if (instance) {
        instance.close();
        instance = null;
      }
    },

    reset(): void {
      instance = null;
    },
  };
}
