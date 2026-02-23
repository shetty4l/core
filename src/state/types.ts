/**
 * Type definitions for the state persistence system.
 */

/** Supported field types for persistence. */
export type FieldType = "string" | "number" | "boolean" | "date";

/** Metadata for a single persisted field. */
export interface FieldMeta {
  /** Property name on the class. */
  property: string;
  /** SQLite column name (snake_case). */
  column: string;
  /** Field type for serialization. */
  type: FieldType;
}

/** Metadata for a persisted class. */
export interface ClassMeta {
  /** SQLite table name. */
  table: string;
  /** Map of property name to field metadata. */
  fields: Map<string, FieldMeta>;
}

/**
 * WeakMap storing class metadata.
 * Keyed by constructor function, holds ClassMeta.
 */
export const classMeta = new WeakMap<object, ClassMeta>();
