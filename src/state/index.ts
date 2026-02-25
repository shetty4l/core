/**
 * State persistence module.
 *
 * Provides decorator-based state persistence with auto-save to SQLite.
 * Supports both singleton state objects (@Persisted) and multi-row
 * collections (@PersistedCollection).
 *
 * @example Singleton state (auto-save on property change)
 * ```ts
 * import { Persisted, Field, StateLoader } from '@shetty4l/core/state';
 *
 * @Persisted('my_state')
 * class MyState {
 *   @Field('number') counter: number = 0;
 *   @Field('date') lastUpdated: Date | null = null;
 * }
 *
 * const loader = new StateLoader(db);
 * const state = loader.load(MyState, 'my-key');
 * state.counter += 1;  // Auto-saves after 100ms
 * await loader.flush(); // Force immediate save
 * ```
 *
 * @example Collection entities (explicit save)
 * ```ts
 * import {
 *   PersistedCollection,
 *   CollectionEntity,
 *   Id,
 *   Field,
 *   Index,
 *   StateLoader
 * } from '@shetty4l/core/state';
 *
 * @PersistedCollection('users')
 * class User extends CollectionEntity {
 *   @Id() id: string = '';
 *   @Field('string') @Index() email: string = '';
 *   @Field('string') name: string = '';
 *
 *   async save(): Promise<void> { throw new Error('Not bound'); }
 *   async delete(): Promise<void> { throw new Error('Not bound'); }
 * }
 *
 * const loader = new StateLoader(db);
 * const user = loader.create(User, { id: 'abc', email: 'a@b.com', name: 'Alice' });
 * user.name = 'Alicia';
 * await user.save();  // Explicit save required
 * ```
 */

// --------------------------------------------------------------------------
// Singleton decorators (@Persisted pattern)
// --------------------------------------------------------------------------

/** Options for the @Field decorator. */
export type { FieldOptions } from "./decorators";
/** Mark a class as persisted to a SQLite table (singleton pattern). */
/** Mark a property as a persisted field (singleton pattern). */
export { Field, Persisted } from "./decorators";

// --------------------------------------------------------------------------
// Collection decorators (@PersistedCollection pattern)
// --------------------------------------------------------------------------

/** Mark a class as a persisted collection (multi-row table). */
/** Mark a property as the primary key field. */
/** Mark column(s) for indexing. */
export { Id, Index, PersistedCollection } from "./collection/decorators";

// --------------------------------------------------------------------------
// Collection base class
// --------------------------------------------------------------------------

/**
 * Abstract base class for collection entities.
 * Provides compile-time type safety to distinguish collection entities
 * from singleton @Persisted classes.
 */
export { CollectionEntity } from "./collection/types";

// --------------------------------------------------------------------------
// Loader
// --------------------------------------------------------------------------

/** Manages loading and persisting state objects. */
export { StateLoader } from "./loader";

// --------------------------------------------------------------------------
// Singleton types
// --------------------------------------------------------------------------

/** Metadata for a @Persisted class. */
/** Metadata for a single persisted field. */
/** Supported field types for persistence. */
export type { ClassMeta, FieldMeta, FieldType } from "./types";

// --------------------------------------------------------------------------
// Collection types
// --------------------------------------------------------------------------

/** Metadata for a @PersistedCollection class. */
/** Options for find() queries. */
/**
 * A where value can be a raw value (treated as eq) or a condition object.
 * @example
 * ```ts
 * // Raw value (eq)
 * { status: 'active' }
 *
 * // Condition object
 * { age: { op: 'gte', value: 18 } }
 * ```
 */
/** Where clause mapping field names to conditions. */
/** Comparison operators for WHERE clauses. */
/** A single where condition with explicit operator. */
/** Order direction for sorting. */
/** Order by clause - field name to direction. */
export type {
  CollectionMeta,
  FindOptions,
  OrderByClause,
  OrderDirection,
  WhereClause,
  WhereCondition,
  WhereOperator,
  WhereValue,
} from "./collection/types";
