/**
 * StateLoader: Load and auto-persist state objects.
 *
 * Provides a proxy-based approach to automatically save state changes
 * to SQLite with debounced writes.
 */

import type { Database, SQLQueryBindings } from "bun:sqlite";
import { ensureTable, migrateAdditive } from "./schema";
import { deserializeValue, serializeValue } from "./serialization";
import type { ClassMeta } from "./types";
import { classMeta } from "./types";

/** Debounce delay in milliseconds. */
const DEBOUNCE_MS = 100;

/**
 * StateLoader manages loading and persisting state objects.
 *
 * @example
 * ```ts
 * const loader = new StateLoader(db);
 * const state = await loader.load(MyState, 'my-key');
 * state.counter += 1;  // Auto-saves after 100ms
 * await loader.flush(); // Force immediate save
 * ```
 */
export class StateLoader {
  private db: Database;
  private pendingSaves = new Map<string, () => void>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Check if a state row exists for the given key.
   *
   * Unlike `load()`, this does NOT create a row if it doesn't exist.
   * Ensures table exists and migrates if needed (consistent with load()).
   *
   * @param Cls - The @Persisted class constructor
   * @param key - Unique key to check
   * @returns `true` if row exists, `false` otherwise
   * @throws Error if class is not decorated with @Persisted
   */
  exists<T extends object>(Cls: new () => T, key: string): boolean {
    // Get metadata
    const meta = classMeta.get(Cls);
    if (!meta || !meta.table) {
      throw new Error(
        `Class "${Cls.name}" is not decorated with @Persisted. ` +
          `Add @Persisted('table_name') to the class.`,
      );
    }

    // Ensure table exists and migrate if needed (consistent with load())
    ensureTable(this.db, meta);
    migrateAdditive(this.db, meta);

    // Check if row exists
    const row = this.selectRow(meta, key);
    return row !== null;
  }

  /**
   * Load a state object by key.
   *
   * If the row doesn't exist, creates one with default values.
   * Returns a proxy that auto-saves on property changes.
   *
   * @param Cls - The @Persisted class constructor
   * @param key - Unique key for this state instance
   * @returns Proxied instance that auto-saves changes
   * @throws Error if class is not decorated with @Persisted
   */
  load<T extends object>(Cls: new () => T, key: string): T {
    // Get metadata
    const meta = classMeta.get(Cls);
    if (!meta || !meta.table) {
      throw new Error(
        `Class "${Cls.name}" is not decorated with @Persisted. ` +
          `Add @Persisted('table_name') to the class.`,
      );
    }

    // Ensure table exists and migrate if needed
    ensureTable(this.db, meta);
    migrateAdditive(this.db, meta);

    // Create instance to get default values
    const instance = new Cls();

    // Try to load existing row
    const row = this.selectRow(meta, key);

    if (row) {
      // Populate instance from row
      for (const field of meta.fields.values()) {
        const rawValue = row[field.column];
        // If column is NULL (e.g., newly added via migration), keep default value
        if (rawValue !== null && rawValue !== undefined) {
          const value = deserializeValue(rawValue, field.type);
          (instance as Record<string, unknown>)[field.property] = value;
        }
      }
    } else {
      // Insert default values
      this.insertRow(meta, key, instance);
    }

    // Return proxy for auto-save
    return this.createProxy(instance, meta, key);
  }

  /**
   * Flush all pending saves immediately.
   *
   * Call this before shutdown to ensure all changes are persisted.
   */
  async flush(): Promise<void> {
    // Cancel all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    // Execute all pending saves
    for (const save of this.pendingSaves.values()) {
      save();
    }
    this.pendingSaves.clear();
  }

  private selectRow(
    meta: ClassMeta,
    key: string,
  ): Record<string, unknown> | null {
    const stmt = this.db.prepare(`SELECT * FROM ${meta.table} WHERE key = ?`);
    return stmt.get(key) as Record<string, unknown> | null;
  }

  private insertRow<T extends object>(
    meta: ClassMeta,
    key: string,
    instance: T,
  ): void {
    const columns = ["key", "updated_at"];
    const placeholders = ["?", "datetime('now')"];
    const values: SQLQueryBindings[] = [key];

    for (const field of meta.fields.values()) {
      columns.push(field.column);
      placeholders.push("?");
      const value = (instance as Record<string, unknown>)[field.property];
      values.push(serializeValue(value, field.type));
    }

    const sql = `INSERT INTO ${meta.table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`;
    this.db.prepare(sql).run(...values);
  }

  private saveRow<T extends object>(
    meta: ClassMeta,
    key: string,
    instance: T,
  ): void {
    const setClauses = ["updated_at = datetime('now')"];
    const values: SQLQueryBindings[] = [];

    for (const field of meta.fields.values()) {
      setClauses.push(`${field.column} = ?`);
      const value = (instance as Record<string, unknown>)[field.property];
      values.push(serializeValue(value, field.type));
    }

    values.push(key);
    const sql = `UPDATE ${meta.table} SET ${setClauses.join(", ")} WHERE key = ?`;
    this.db.prepare(sql).run(...values);
  }

  private createProxy<T extends object>(
    instance: T,
    meta: ClassMeta,
    key: string,
  ): T {
    const saveKey = `${meta.table}:${key}`;
    const scheduleSave = this.scheduleSave.bind(this);
    const saveRow = this.saveRow.bind(this);

    return new Proxy(instance, {
      set(target, prop, value): boolean {
        // Set the value
        (target as Record<string | symbol, unknown>)[prop] = value;

        // Only schedule save for @Field properties
        const propStr = String(prop);
        if (!meta.fields.has(propStr)) {
          return true;
        }

        // Schedule debounced save
        scheduleSave(saveKey, () => {
          saveRow(meta, key, target);
        });

        return true;
      },

      get(target, prop, receiver): unknown {
        const value = Reflect.get(target, prop, receiver);
        // Bind methods to the target
        if (typeof value === "function") {
          return value.bind(target);
        }
        return value;
      },

      ownKeys(target): (string | symbol)[] {
        return Reflect.ownKeys(target);
      },

      getOwnPropertyDescriptor(target, prop): PropertyDescriptor | undefined {
        return Object.getOwnPropertyDescriptor(target, prop);
      },
    });
  }

  private scheduleSave(saveKey: string, saveFn: () => void): void {
    // Cancel existing timer
    const existingTimer = this.timers.get(saveKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Store the save function
    this.pendingSaves.set(saveKey, saveFn);

    // Schedule new timer
    const timer = setTimeout(() => {
      this.timers.delete(saveKey);
      const fn = this.pendingSaves.get(saveKey);
      if (fn) {
        fn();
        this.pendingSaves.delete(saveKey);
      }
    }, DEBOUNCE_MS);

    this.timers.set(saveKey, timer);
  }
}
