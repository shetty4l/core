/**
 * Query builder for collection WHERE and ORDER BY clauses.
 *
 * Produces parameterized SQL to prevent injection attacks.
 * All values are returned as bind parameters, never interpolated.
 */

import type { SQLQueryBindings } from "bun:sqlite";
import type {
  CollectionMeta,
  OrderByClause,
  OrderDirection,
  WhereClause,
  WhereCondition,
  WhereOperator,
} from "./types";

/**
 * Result of building a WHERE clause.
 */
export interface WhereResult {
  /** SQL WHERE clause fragment (without 'WHERE' keyword). Empty string if no conditions. */
  sql: string;
  /** Bind parameters for the query. */
  params: SQLQueryBindings[];
}

/**
 * Check if a value is a WhereCondition object.
 */
function isWhereCondition<T>(value: unknown): value is WhereCondition<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "op" in value &&
    typeof (value as WhereCondition<T>).op === "string"
  );
}

/**
 * Map a property name to its column name using metadata.
 *
 * @param meta - Collection metadata
 * @param property - Property name
 * @returns Column name
 * @throws Error if property not found in metadata
 */
function getColumn(meta: CollectionMeta, property: string): string {
  if (property === meta.idProperty) {
    return meta.idColumn;
  }

  // Handle auto-managed timestamp fields
  if (property === "created_at") {
    return "created_at";
  }
  if (property === "updated_at") {
    return "updated_at";
  }

  const field = meta.fields.get(property);
  if (!field) {
    throw new Error(
      `Property "${property}" not found in collection "${meta.table}". ` +
        `Available fields: ${meta.idProperty}, ${[...meta.fields.keys()].join(", ")}, created_at, updated_at`,
    );
  }
  return field.column;
}

/**
 * Serialize a value for SQL binding.
 * Converts Date objects to ISO strings, passes other values through.
 */
function serializeBindValue(value: unknown): SQLQueryBindings {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value as SQLQueryBindings;
}

/**
 * Build SQL condition fragment and params for a single operator.
 *
 * @param column - Column name
 * @param op - Comparison operator
 * @param value - Value for comparison
 * @returns SQL fragment and params tuple
 */
function buildOperatorCondition(
  column: string,
  op: WhereOperator,
  value: unknown,
): { sql: string; params: SQLQueryBindings[] } {
  switch (op) {
    case "eq":
      return { sql: `${column} = ?`, params: [serializeBindValue(value)] };

    case "neq":
      return { sql: `${column} != ?`, params: [serializeBindValue(value)] };

    case "lt":
      return { sql: `${column} < ?`, params: [serializeBindValue(value)] };

    case "lte":
      return { sql: `${column} <= ?`, params: [serializeBindValue(value)] };

    case "gt":
      return { sql: `${column} > ?`, params: [serializeBindValue(value)] };

    case "gte":
      return { sql: `${column} >= ?`, params: [serializeBindValue(value)] };

    case "in": {
      const arr = value as unknown[];
      if (!Array.isArray(arr) || arr.length === 0) {
        // Empty IN clause: always false
        return { sql: "0 = 1", params: [] };
      }
      const placeholders = arr.map(() => "?").join(", ");
      return {
        sql: `${column} IN (${placeholders})`,
        params: arr.map(serializeBindValue),
      };
    }

    case "notIn": {
      const arr = value as unknown[];
      if (!Array.isArray(arr) || arr.length === 0) {
        // Empty NOT IN clause: always true (no exclusions)
        return { sql: "1 = 1", params: [] };
      }
      const placeholders = arr.map(() => "?").join(", ");
      return {
        sql: `${column} NOT IN (${placeholders})`,
        params: arr.map(serializeBindValue),
      };
    }

    case "isNull":
      return { sql: `${column} IS NULL`, params: [] };

    case "isNotNull":
      return { sql: `${column} IS NOT NULL`, params: [] };

    case "contains":
      // LIKE '%value%' - escape special LIKE chars
      return {
        sql: `${column} LIKE ? ESCAPE '\\'`,
        params: [`%${escapeLike(String(value))}%`],
      };

    case "startsWith":
      // LIKE 'value%'
      return {
        sql: `${column} LIKE ? ESCAPE '\\'`,
        params: [`${escapeLike(String(value))}%`],
      };

    case "endsWith":
      // LIKE '%value'
      return {
        sql: `${column} LIKE ? ESCAPE '\\'`,
        params: [`%${escapeLike(String(value))}`],
      };
  }
}

/**
 * Escape special characters for LIKE patterns.
 *
 * SQLite LIKE special chars: % _
 */
function escapeLike(value: string): string {
  return value.replace(/[%_]/g, (char) => `\\${char}`);
}

/**
 * Build a WHERE clause from a WhereClause object.
 *
 * @param meta - Collection metadata
 * @param where - Where clause object mapping property names to conditions
 * @returns WhereResult with SQL fragment and bind parameters
 *
 * @example
 * ```ts
 * const { sql, params } = buildWhere(meta, {
 *   status: 'active',
 *   age: { op: 'gte', value: 18 },
 * });
 * // sql: "status = ? AND age >= ?"
 * // params: ['active', 18]
 * ```
 */
export function buildWhere<T>(
  meta: CollectionMeta,
  where: WhereClause<T> | undefined,
): WhereResult {
  if (!where || Object.keys(where).length === 0) {
    return { sql: "", params: [] };
  }

  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  for (const [property, whereValue] of Object.entries(where)) {
    if (whereValue === undefined) {
      continue;
    }

    const column = getColumn(meta, property);

    // Determine operator and value
    let op: WhereOperator;
    let value: unknown;

    if (isWhereCondition(whereValue)) {
      op = whereValue.op;
      value = whereValue.value;
    } else {
      // Raw value treated as eq
      op = "eq";
      value = whereValue;
    }

    const result = buildOperatorCondition(column, op, value);
    conditions.push(result.sql);
    params.push(...result.params);
  }

  if (conditions.length === 0) {
    return { sql: "", params: [] };
  }

  return {
    sql: conditions.join(" AND "),
    params,
  };
}

/**
 * Build an ORDER BY clause from an OrderByClause object.
 *
 * @param meta - Collection metadata
 * @param orderBy - Order by clause object mapping property names to direction
 * @returns SQL ORDER BY clause (without 'ORDER BY' keyword), empty string if no ordering
 *
 * @example
 * ```ts
 * const sql = buildOrderBy(meta, { createdAt: 'desc', name: 'asc' });
 * // "created_at DESC, name ASC"
 * ```
 */
export function buildOrderBy<T>(
  meta: CollectionMeta,
  orderBy: OrderByClause<T> | undefined,
): string {
  if (!orderBy || Object.keys(orderBy).length === 0) {
    return "";
  }

  const clauses: string[] = [];

  for (const [property, direction] of Object.entries(orderBy)) {
    if (direction === undefined) {
      continue;
    }

    const column = getColumn(meta, property);
    const dir = (direction as OrderDirection).toUpperCase();

    // Validate direction to prevent injection
    if (dir !== "ASC" && dir !== "DESC") {
      throw new Error(
        `Invalid order direction "${direction}" for property "${property}". ` +
          `Use 'asc' or 'desc'.`,
      );
    }

    clauses.push(`${column} ${dir}`);
  }

  return clauses.join(", ");
}
