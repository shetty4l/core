/**
 * Serialization utilities for SQLite persistence.
 *
 * Handles conversion between JavaScript types and SQLite-compatible values.
 */

import type { FieldType } from "./types";

/** SQLite column type. */
export type SqliteType = "TEXT" | "REAL" | "INTEGER";

/**
 * Serialize a JavaScript value for SQLite storage.
 *
 * @param value - The value to serialize
 * @param type - The field type
 * @returns SQLite-compatible value
 * @throws Error if value is NaN or Infinity
 */
export function serializeValue(
  value: unknown,
  type: FieldType,
): string | number | null {
  if (value === null || value === undefined) {
    return null;
  }

  switch (type) {
    case "string":
      return String(value);

    case "number": {
      const num = value as number;
      if (Number.isNaN(num)) {
        throw new Error(
          "Cannot serialize NaN to SQLite. Ensure the value is a valid number.",
        );
      }
      if (!Number.isFinite(num)) {
        throw new Error(
          "Cannot serialize Infinity to SQLite. Ensure the value is a finite number.",
        );
      }
      return num;
    }

    case "boolean":
      return value ? 1 : 0;

    case "date":
      return (value as Date).toISOString();
  }
}

/**
 * Deserialize a SQLite value to a JavaScript type.
 *
 * @param value - The SQLite value
 * @param type - The field type
 * @returns Deserialized JavaScript value
 */
export function deserializeValue(
  value: unknown,
  type: FieldType,
): string | number | boolean | Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  switch (type) {
    case "string":
      return String(value);

    case "number":
      return Number(value);

    case "boolean":
      return value === 1 || value === true;

    case "date":
      return new Date(value as string);
  }
}

/**
 * Get the SQLite column type for a field type.
 *
 * @param type - The field type
 * @returns SQLite column type
 */
export function sqliteType(type: FieldType): SqliteType {
  switch (type) {
    case "string":
    case "date":
      return "TEXT";

    case "number":
      return "REAL";

    case "boolean":
      return "INTEGER";
  }
}
