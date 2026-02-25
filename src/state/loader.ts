/**
 * StateLoader: Load and auto-persist state objects.
 *
 * Provides a proxy-based approach to automatically save state changes
 * to SQLite with debounced writes. Supports both singleton @Persisted
 * classes and multi-row @PersistedCollection classes.
 */

import type { Database, SQLQueryBindings } from "bun:sqlite";
import { buildOrderBy, buildWhere } from "./collection/query";
import {
  CollectionEntity,
  type CollectionMeta,
  collectionMeta,
  type FieldType,
  type FindOptions,
} from "./collection/types";
import {
  ensureCollectionTable,
  ensureIndices,
  ensureTable,
  migrateAdditive,
  migrateCollectionAdditive,
} from "./schema";
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
   * @throws Error (compile-time) if class extends CollectionEntity
   */
  exists<T extends CollectionEntity>(Cls: new () => T, key: string): never;
  exists<T extends object>(Cls: new () => T, key: string): boolean;
  exists<T extends object>(Cls: new () => T, key: string): boolean {
    // Runtime check: CollectionEntity classes should use get() instead
    if (collectionMeta.has(Cls)) {
      throw new Error(
        `Class "${Cls.name}" is a @PersistedCollection. ` +
          `Use get() or find() instead of exists().`,
      );
    }

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
   * @throws Error (compile-time) if class extends CollectionEntity
   */
  load<T extends CollectionEntity>(Cls: new () => T, key: string): never;
  load<T extends object>(Cls: new () => T, key: string): T;
  load<T extends object>(Cls: new () => T, key: string): T {
    // Runtime check: CollectionEntity classes should use get() instead
    if (collectionMeta.has(Cls)) {
      throw new Error(
        `Class "${Cls.name}" is a @PersistedCollection. ` +
          `Use get() or find() instead of load().`,
      );
    }

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

  // --------------------------------------------------------------------------
  // Collection methods (for @PersistedCollection classes)
  // --------------------------------------------------------------------------

  /**
   * Create a new collection entity and persist it.
   *
   * Inserts a new row into the collection table. The entity's @Id field
   * must be set before calling create(). Returns a bound entity with
   * working save() and delete() methods.
   *
   * @param Cls - The @PersistedCollection class constructor
   * @param data - Partial entity data to initialize with
   * @returns Bound entity instance with save() and delete() methods
   * @throws Error if class is not decorated with @PersistedCollection
   * @throws Error if INSERT fails (e.g., duplicate primary key)
   *
   * @example
   * ```ts
   * const user = await loader.create(User, { id: 'abc123', name: 'Alice' });
   * user.name = 'Alicia';
   * await user.save();
   * ```
   */
  create<T extends CollectionEntity>(
    Cls: new () => T,
    data: Partial<Omit<T, "save" | "delete">>,
  ): T {
    const meta = this.getCollectionMeta(Cls);

    // Ensure table and indices exist
    ensureCollectionTable(this.db, meta);
    migrateCollectionAdditive(this.db, meta);
    ensureIndices(this.db, meta);

    // Create instance and populate with data
    const instance = new Cls();
    Object.assign(instance, data);

    // Insert row
    this.insertCollectionRow(meta, instance);

    // Return bound entity
    return this.bindCollectionEntity(instance, meta);
  }

  /**
   * Get a single entity by its primary key.
   *
   * @param Cls - The @PersistedCollection class constructor
   * @param id - Primary key value
   * @returns Bound entity instance or null if not found
   * @throws Error if class is not decorated with @PersistedCollection
   *
   * @example
   * ```ts
   * const user = loader.get(User, 'abc123');
   * if (user) {
   *   console.log(user.name);
   * }
   * ```
   */
  get<T extends CollectionEntity>(
    Cls: new () => T,
    id: string | number,
  ): T | null {
    const meta = this.getCollectionMeta(Cls);

    // Ensure table and indices exist
    ensureCollectionTable(this.db, meta);
    migrateCollectionAdditive(this.db, meta);
    ensureIndices(this.db, meta);

    // Query by primary key
    const sql = `SELECT * FROM ${meta.table} WHERE ${meta.idColumn} = ?`;
    const row = this.db.prepare(sql).get(id) as Record<string, unknown> | null;

    if (!row) {
      return null;
    }

    // Create instance and populate from row
    const instance = new Cls();
    this.populateCollectionInstance(instance, meta, row);

    return this.bindCollectionEntity(instance, meta);
  }

  /**
   * Find entities matching the given criteria.
   *
   * @param Cls - The @PersistedCollection class constructor
   * @param options - Query options (where, orderBy, limit, offset)
   * @returns Array of bound entity instances
   * @throws Error if class is not decorated with @PersistedCollection
   *
   * @example
   * ```ts
   * const users = loader.find(User, {
   *   where: { status: 'active', age: { op: 'gte', value: 18 } },
   *   orderBy: { createdAt: 'desc' },
   *   limit: 10,
   * });
   * ```
   */
  find<T extends CollectionEntity>(
    Cls: new () => T,
    options?: FindOptions<T>,
  ): T[] {
    const meta = this.getCollectionMeta(Cls);

    // Ensure table and indices exist
    ensureCollectionTable(this.db, meta);
    migrateCollectionAdditive(this.db, meta);
    ensureIndices(this.db, meta);

    // Build query
    let sql = `SELECT * FROM ${meta.table}`;
    const params: SQLQueryBindings[] = [];

    // WHERE clause
    const whereResult = buildWhere(meta, options?.where);
    if (whereResult.sql) {
      sql += ` WHERE ${whereResult.sql}`;
      params.push(...whereResult.params);
    }

    // ORDER BY clause
    const orderBySql = buildOrderBy(meta, options?.orderBy);
    if (orderBySql) {
      sql += ` ORDER BY ${orderBySql}`;
    }

    // LIMIT and OFFSET
    if (options?.limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }
    if (options?.offset !== undefined) {
      sql += ` OFFSET ?`;
      params.push(options.offset);
    }

    // Execute query
    const rows = this.db.prepare(sql).all(...params) as Record<
      string,
      unknown
    >[];

    // Map rows to bound entities
    return rows.map((row) => {
      const instance = new Cls();
      this.populateCollectionInstance(instance, meta, row);
      return this.bindCollectionEntity(instance, meta);
    });
  }

  /**
   * Count entities matching the given criteria.
   *
   * @param Cls - The @PersistedCollection class constructor
   * @param where - Optional filter conditions
   * @returns Number of matching entities
   * @throws Error if class is not decorated with @PersistedCollection
   *
   * @example
   * ```ts
   * const activeCount = loader.count(User, { status: 'active' });
   * ```
   */
  count<T extends CollectionEntity>(
    Cls: new () => T,
    where?: FindOptions<T>["where"],
  ): number {
    const meta = this.getCollectionMeta(Cls);

    // Ensure table and indices exist
    ensureCollectionTable(this.db, meta);
    migrateCollectionAdditive(this.db, meta);
    ensureIndices(this.db, meta);

    // Build query
    let sql = `SELECT COUNT(*) as count FROM ${meta.table}`;
    const params: SQLQueryBindings[] = [];

    // WHERE clause
    const whereResult = buildWhere(meta, where);
    if (whereResult.sql) {
      sql += ` WHERE ${whereResult.sql}`;
      params.push(...whereResult.params);
    }

    // Execute query
    const result = this.db.prepare(sql).get(...params) as { count: number };
    return result.count;
  }

  // --------------------------------------------------------------------------
  // Bulk operations (for @PersistedCollection classes)
  // --------------------------------------------------------------------------

  /**
   * Insert or replace an entity (upsert).
   *
   * If an entity with the same primary key exists, it will be replaced.
   * Otherwise, a new row is inserted. Returns a bound entity with
   * working save() and delete() methods.
   *
   * @param Cls - The @PersistedCollection class constructor
   * @param data - Entity data including the @Id field
   * @returns Bound entity instance with save() and delete() methods
   * @throws Error if class is not decorated with @PersistedCollection
   *
   * @example
   * ```ts
   * const user = loader.upsert(User, { id: 'abc123', name: 'Alice' });
   * // If user exists, it's updated; otherwise created
   * ```
   */
  upsert<T extends CollectionEntity>(
    Cls: new () => T,
    data: Partial<Omit<T, "save" | "delete">>,
  ): T {
    const meta = this.getCollectionMeta(Cls);

    // Ensure table and indices exist
    ensureCollectionTable(this.db, meta);
    migrateCollectionAdditive(this.db, meta);
    ensureIndices(this.db, meta);

    // Create instance and populate with data
    const instance = new Cls();
    Object.assign(instance, data);

    // Upsert row
    this.upsertCollectionRow(meta, instance);

    // Return bound entity
    return this.bindCollectionEntity(instance, meta);
  }

  /**
   * Update multiple entities matching the given criteria.
   *
   * @param Cls - The @PersistedCollection class constructor
   * @param where - Filter conditions to select rows to update
   * @param updates - Partial data to apply to matching rows
   * @returns Number of rows updated
   * @throws Error if class is not decorated with @PersistedCollection
   *
   * @example
   * ```ts
   * const count = loader.updateWhere(User,
   *   { status: 'pending' },
   *   { status: 'active' }
   * );
   * console.log(`Updated ${count} users`);
   * ```
   */
  updateWhere<T extends CollectionEntity>(
    Cls: new () => T,
    where: FindOptions<T>["where"],
    updates: Partial<Omit<T, "save" | "delete">>,
  ): number {
    const meta = this.getCollectionMeta(Cls);

    // Ensure table and indices exist
    ensureCollectionTable(this.db, meta);
    migrateCollectionAdditive(this.db, meta);
    ensureIndices(this.db, meta);

    // Build SET clause from updates
    const setClauses: string[] = ["updated_at = datetime('now')"];
    const setParams: SQLQueryBindings[] = [];

    for (const [property, value] of Object.entries(updates)) {
      if (value === undefined) {
        continue;
      }

      // Get column name - check if it's the id field or a regular field
      let column: string;
      let fieldType: FieldType;

      if (property === meta.idProperty) {
        column = meta.idColumn;
        fieldType = meta.idType;
      } else {
        const field = meta.fields.get(property);
        if (!field) {
          continue; // Skip unknown properties
        }
        column = field.column;
        fieldType = field.type;
      }

      setClauses.push(`${column} = ?`);
      setParams.push(serializeValue(value, fieldType));
    }

    // Build WHERE clause
    const whereResult = buildWhere(meta, where);

    // Require at least one WHERE condition to prevent accidental bulk updates
    if (!whereResult.sql) {
      throw new Error(
        `updateWhere() requires at least one WHERE condition. ` +
          `Pass a non-empty filter to prevent accidental bulk updates.`,
      );
    }

    // Build full SQL
    const sql = `UPDATE ${meta.table} SET ${setClauses.join(", ")} WHERE ${whereResult.sql}`;
    const params: SQLQueryBindings[] = [...setParams, ...whereResult.params];

    // Execute query
    const result = this.db.prepare(sql).run(...params);
    return result.changes;
  }

  /**
   * Delete multiple entities matching the given criteria.
   *
   * @param Cls - The @PersistedCollection class constructor
   * @param where - Filter conditions to select rows to delete
   * @returns Number of rows deleted
   * @throws Error if class is not decorated with @PersistedCollection
   *
   * @example
   * ```ts
   * const count = loader.deleteWhere(User, { status: 'inactive' });
   * console.log(`Deleted ${count} inactive users`);
   * ```
   */
  deleteWhere<T extends CollectionEntity>(
    Cls: new () => T,
    where: FindOptions<T>["where"],
  ): number {
    const meta = this.getCollectionMeta(Cls);

    // Ensure table and indices exist
    ensureCollectionTable(this.db, meta);
    migrateCollectionAdditive(this.db, meta);
    ensureIndices(this.db, meta);

    // Build WHERE clause
    const whereResult = buildWhere(meta, where);

    // Require at least one WHERE condition to prevent accidental bulk deletes
    if (!whereResult.sql) {
      throw new Error(
        `deleteWhere() requires at least one WHERE condition. ` +
          `Pass a non-empty filter to prevent accidental bulk deletes.`,
      );
    }

    // Build full SQL
    const sql = `DELETE FROM ${meta.table} WHERE ${whereResult.sql}`;
    const params: SQLQueryBindings[] = [...whereResult.params];

    // Execute query
    const result = this.db.prepare(sql).run(...params);
    return result.changes;
  }

  /**
   * Execute a function within a database transaction.
   *
   * Uses BEGIN IMMEDIATE to acquire a write lock immediately, preventing
   * other writers. If the function throws, the transaction is rolled back.
   * Otherwise, it is committed.
   *
   * @param fn - The function to execute within the transaction
   * @returns The return value of the function
   * @throws Error if the function throws (transaction is rolled back)
   *
   * @example
   * ```ts
   * await loader.transaction(async () => {
   *   const user = loader.get(User, 'abc123');
   *   if (user) {
   *     user.balance -= 100;
   *     await user.save();
   *   }
   *   const order = loader.create(Order, { userId: 'abc123', amount: 100 });
   * });
   * ```
   */
  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Convenience method for single-entity sync updates with auto-save.
   *
   * Fetches an entity by ID, applies a synchronous update function,
   * and automatically saves the entity. Throws if the entity is not found.
   *
   * @param Cls - The @PersistedCollection class constructor
   * @param id - Primary key value
   * @param fn - Synchronous function to modify the entity
   * @returns The modified and saved entity
   * @throws Error if entity is not found
   *
   * @example
   * ```ts
   * const user = await loader.modify(User, 'abc123', (user) => {
   *   user.lastLogin = new Date();
   *   user.loginCount += 1;
   * });
   * ```
   */
  async modify<T extends CollectionEntity>(
    Cls: new () => T,
    id: string | number,
    fn: (entity: T) => void,
  ): Promise<T> {
    const entity = this.get(Cls, id);
    if (!entity) {
      throw new Error(
        `Entity "${Cls.name}" with id "${id}" not found. ` +
          `Use get() to check existence before calling modify().`,
      );
    }

    fn(entity);
    await entity.save();
    return entity;
  }

  // --------------------------------------------------------------------------
  // Collection private helpers
  // --------------------------------------------------------------------------

  /**
   * Get collection metadata for a class, ensuring it's properly decorated.
   */
  private getCollectionMeta(Cls: new () => CollectionEntity): CollectionMeta {
    const meta = collectionMeta.get(Cls);
    if (!meta) {
      throw new Error(
        `Class "${Cls.name}" is not decorated with @PersistedCollection. ` +
          `Add @PersistedCollection('table_name') to the class.`,
      );
    }
    return meta;
  }

  /**
   * Insert a new collection entity row.
   */
  private insertCollectionRow<T extends CollectionEntity>(
    meta: CollectionMeta,
    instance: T,
  ): void {
    const columns: string[] = [meta.idColumn, "created_at", "updated_at"];
    const placeholders: string[] = ["?", "datetime('now')", "datetime('now')"];
    const values: SQLQueryBindings[] = [
      (instance as Record<string, unknown>)[
        meta.idProperty
      ] as SQLQueryBindings,
    ];

    // Add all field columns
    for (const field of meta.fields.values()) {
      columns.push(field.column);
      placeholders.push("?");
      const value = (instance as Record<string, unknown>)[field.property];
      values.push(serializeValue(value, field.type));
    }

    const sql = `INSERT INTO ${meta.table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`;
    this.db.prepare(sql).run(...values);
  }

  /**
   * Insert or replace a collection entity row (upsert).
   * Uses ON CONFLICT to preserve created_at on updates.
   */
  private upsertCollectionRow<T extends CollectionEntity>(
    meta: CollectionMeta,
    instance: T,
  ): void {
    const columns: string[] = [meta.idColumn, "created_at", "updated_at"];
    const placeholders: string[] = ["?", "datetime('now')", "datetime('now')"];
    const values: SQLQueryBindings[] = [
      (instance as Record<string, unknown>)[
        meta.idProperty
      ] as SQLQueryBindings,
    ];

    // Build update clauses for ON CONFLICT (excludes id and created_at)
    const updateClauses: string[] = ["updated_at = datetime('now')"];

    // Add all field columns
    for (const field of meta.fields.values()) {
      columns.push(field.column);
      placeholders.push("?");
      const value = (instance as Record<string, unknown>)[field.property];
      values.push(serializeValue(value, field.type));
      updateClauses.push(`${field.column} = excluded.${field.column}`);
    }

    // Use INSERT ... ON CONFLICT to preserve created_at on update
    const sql =
      `INSERT INTO ${meta.table} (${columns.join(", ")}) ` +
      `VALUES (${placeholders.join(", ")}) ` +
      `ON CONFLICT(${meta.idColumn}) DO UPDATE SET ${updateClauses.join(", ")}`;
    this.db.prepare(sql).run(...values);
  }

  /**
   * Save (update) an existing collection entity row.
   */
  private saveCollectionRow<T extends CollectionEntity>(
    meta: CollectionMeta,
    instance: T,
  ): void {
    const setClauses: string[] = ["updated_at = datetime('now')"];
    const values: SQLQueryBindings[] = [];

    // Add all field columns
    for (const field of meta.fields.values()) {
      setClauses.push(`${field.column} = ?`);
      const value = (instance as Record<string, unknown>)[field.property];
      values.push(serializeValue(value, field.type));
    }

    // Add id value for WHERE clause
    const idValue = (instance as Record<string, unknown>)[
      meta.idProperty
    ] as SQLQueryBindings;
    values.push(idValue);

    const sql = `UPDATE ${meta.table} SET ${setClauses.join(", ")} WHERE ${meta.idColumn} = ?`;
    this.db.prepare(sql).run(...values);
  }

  /**
   * Delete a collection entity row.
   */
  private deleteCollectionRow<T extends CollectionEntity>(
    meta: CollectionMeta,
    instance: T,
  ): void {
    const idValue = (instance as Record<string, unknown>)[
      meta.idProperty
    ] as SQLQueryBindings;
    const sql = `DELETE FROM ${meta.table} WHERE ${meta.idColumn} = ?`;
    this.db.prepare(sql).run(idValue);
  }

  /**
   * Populate a collection instance from a database row.
   */
  private populateCollectionInstance<T extends CollectionEntity>(
    instance: T,
    meta: CollectionMeta,
    row: Record<string, unknown>,
  ): void {
    // Set id field
    const rawId = row[meta.idColumn];
    if (rawId !== null && rawId !== undefined) {
      const idValue = deserializeValue(rawId, meta.idType);
      (instance as Record<string, unknown>)[meta.idProperty] = idValue;
    }

    // Set all other fields
    for (const field of meta.fields.values()) {
      const rawValue = row[field.column];
      if (rawValue !== null && rawValue !== undefined) {
        const value = deserializeValue(rawValue, field.type);
        (instance as Record<string, unknown>)[field.property] = value;
      }
    }

    // Set auto-managed timestamps
    const rawCreatedAt = row.created_at;
    if (rawCreatedAt !== null && rawCreatedAt !== undefined) {
      const createdAtValue = deserializeValue(rawCreatedAt, "date");
      (instance as Record<string, unknown>).created_at = createdAtValue;
    }

    const rawUpdatedAt = row.updated_at;
    if (rawUpdatedAt !== null && rawUpdatedAt !== undefined) {
      const updatedAtValue = deserializeValue(rawUpdatedAt, "date");
      (instance as Record<string, unknown>).updated_at = updatedAtValue;
    }
  }

  /**
   * Bind save() and delete() methods to a collection entity.
   */
  private bindCollectionEntity<T extends CollectionEntity>(
    instance: T,
    meta: CollectionMeta,
  ): T {
    const saveRow = this.saveCollectionRow.bind(this);
    const deleteRow = this.deleteCollectionRow.bind(this);

    // Override abstract methods with concrete implementations
    (instance as unknown as { save: () => Promise<void> }).save =
      async function (): Promise<void> {
        saveRow(meta, instance);
      };

    (instance as unknown as { delete: () => Promise<void> }).delete =
      async function (): Promise<void> {
        deleteRow(meta, instance);
      };

    return instance;
  }

  // --------------------------------------------------------------------------
  // Singleton private helpers
  // --------------------------------------------------------------------------

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
