/**
 * Type definitions for the collection persistence system.
 *
 * Collections are multi-row tables with explicit primary keys,
 * as opposed to singleton @Persisted classes which use a key column.
 */

/** Supported field types for persistence (same as singleton). */
export type FieldType = "string" | "number" | "boolean" | "date";

/** Metadata for a single persisted field in a collection. */
export interface CollectionFieldMeta {
  /** Property name on the class. */
  property: string;
  /** SQLite column name (snake_case). */
  column: string;
  /** Field type for serialization. */
  type: FieldType;
}

/** Index definition for a collection table. */
export interface IndexMeta {
  /** Column names to index (snake_case). */
  columns: string[];
}

/** Metadata for a @PersistedCollection class. */
export interface CollectionMeta {
  /** SQLite table name. */
  table: string;
  /** Property name of the @Id field. */
  idProperty: string;
  /** Column name of the @Id field. */
  idColumn: string;
  /** Type of the @Id field. */
  idType: FieldType;
  /** Map of property name to field metadata (excludes id field). */
  fields: Map<string, CollectionFieldMeta>;
  /** Index definitions. */
  indices: IndexMeta[];
}

/**
 * WeakMap storing collection metadata.
 * Keyed by constructor function, holds CollectionMeta.
 */
export const collectionMeta = new WeakMap<object, CollectionMeta>();

// --------------------------------------------------------------------------
// Query types
// --------------------------------------------------------------------------

/**
 * Comparison operators for WHERE clauses.
 */
export type WhereOperator =
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "in"
  | "notIn"
  | "isNull"
  | "isNotNull"
  | "contains"
  | "startsWith"
  | "endsWith";

/**
 * A single where condition with explicit operator.
 */
export interface WhereCondition<T> {
  op: WhereOperator;
  value: T;
}

/**
 * A where value can be:
 * - A raw value (treated as eq)
 * - A condition object with operator
 */
export type WhereValue<T> = T | WhereCondition<T>;

/**
 * Where clause mapping field names to conditions.
 * Keys are property names, values are WhereValue.
 */
export type WhereClause<T> = {
  [K in keyof T]?: WhereValue<T[K]>;
};

/**
 * Order direction for sorting.
 */
export type OrderDirection = "asc" | "desc";

/**
 * Order by clause - field name to direction.
 */
export type OrderByClause<T> = {
  [K in keyof T]?: OrderDirection;
};

/**
 * Options for find() queries.
 */
export interface FindOptions<T> {
  /** Filter conditions. */
  where?: WhereClause<T>;
  /** Sort order. */
  orderBy?: OrderByClause<T>;
  /** Maximum number of results. */
  limit?: number;
  /** Number of results to skip. */
  offset?: number;
}

// --------------------------------------------------------------------------
// CollectionEntity base class
// --------------------------------------------------------------------------

/**
 * Abstract base class for collection entities.
 *
 * Provides compile-time type safety to distinguish collection entities
 * from singleton @Persisted classes. Subclasses must be decorated with
 * @PersistedCollection.
 *
 * @example
 * ```ts
 * @PersistedCollection('users')
 * class User extends CollectionEntity {
 *   @Id() id: string = '';
 *   @Field('string') name: string = '';
 *
 *   async save(): Promise<void> {
 *     // Implemented by StateLoader binding
 *   }
 *
 *   async delete(): Promise<void> {
 *     // Implemented by StateLoader binding
 *   }
 * }
 * ```
 */
export abstract class CollectionEntity {
  /**
   * Persist this entity to the database.
   * Implemented when the entity is bound to a StateLoader.
   */
  abstract save(): Promise<void>;

  /**
   * Delete this entity from the database.
   * Implemented when the entity is bound to a StateLoader.
   */
  abstract delete(): Promise<void>;
}
