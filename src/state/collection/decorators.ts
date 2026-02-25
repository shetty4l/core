/**
 * TC39 decorators for collection persistence.
 *
 * Uses the same global accumulator pattern as @Persisted decorators
 * to work around Bun's TC39 decorator quirks.
 *
 * @example
 * ```ts
 * @PersistedCollection('users')
 * class User extends CollectionEntity {
 *   @Id() id: string = '';
 *   @Field('string') @Index() email: string = '';
 *   @Field('string') name: string = '';
 *   @Field('date') @Index(['status', 'created_at']) createdAt: Date | null = null;
 *   @Field('string') status: string = 'active';
 * }
 * ```
 */

import {
  type CollectionFieldMeta,
  collectionMeta,
  type FieldType,
  type IndexMeta,
} from "./types";

/**
 * Convert camelCase to snake_case.
 * Handles leading uppercase (e.g., 'ID' -> 'id', not '_i_d').
 */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter, index) =>
    index === 0 ? letter.toLowerCase() : `_${letter.toLowerCase()}`,
  );
}

/**
 * Extract property name from TC39 decorator context.
 *
 * TC39 field decorator context is a ClassFieldDecoratorContext object with a `name` property.
 * This handles both the standard TC39 context object and legacy string contexts.
 */
function extractPropertyName(context: unknown): string {
  if (typeof context === "object" && context !== null && "name" in context) {
    return String((context as { name: unknown }).name);
  }
  return String(context);
}

/** Options for the @Field decorator. */
export interface FieldOptions {
  /** Custom column name. Defaults to snake_case of property name. */
  column?: string;
}

/** Options for the @Id decorator. */
export interface IdOptions {
  /** Custom column name. Defaults to 'id'. */
  column?: string;
}

// --------------------------------------------------------------------------
// Global accumulators for pending definitions
// --------------------------------------------------------------------------

type PendingFieldDef = { column: string; type: FieldType };
type PendingFieldsMap = Map<string, PendingFieldDef>;
type PendingIdDef = { property: string; column: string; type: FieldType };
type PendingIndexDef = { columns: string[] };

// In Bun's TC39 implementation, field decorators run synchronously
// before the class decorator for the same class.
let globalPendingFields: PendingFieldsMap | null = null;
let globalPendingId: PendingIdDef | null = null;
let globalPendingIdCount = 0; // Track multiple @Id to detect error
let globalPendingIndices: PendingIndexDef[] | null = null;

/**
 * Reset all global accumulator state.
 * Called before throwing errors to prevent stale data affecting subsequent classes.
 */
function resetGlobalState(): void {
  globalPendingFields = null;
  globalPendingId = null;
  globalPendingIdCount = 0;
  globalPendingIndices = null;
}

/**
 * Mark a class as a persisted collection (multi-row table).
 *
 * @param table - SQLite table name
 * @throws Error if class extends another @PersistedCollection class
 * @throws Error if no @Id field is defined
 */
export function PersistedCollection(table: string) {
  // Bun's TC39 decorator: context is undefined, not ClassDecoratorContext
  return function <T extends new (...args: unknown[]) => object>(
    target: T,
    _context: unknown,
  ): T {
    // Check prototype chain for existing @PersistedCollection class
    let proto = Object.getPrototypeOf(target);
    while (proto && proto !== Function.prototype) {
      if (collectionMeta.has(proto)) {
        const parentMeta = collectionMeta.get(proto)!;
        resetGlobalState();
        throw new Error(
          `@PersistedCollection class "${target.name}" cannot extend @PersistedCollection class "${proto.name}" (table: "${parentMeta.table}"). ` +
            `Collection classes do not support inheritance.`,
        );
      }
      proto = Object.getPrototypeOf(proto);
    }

    // Check that @Id was defined
    if (!globalPendingId) {
      resetGlobalState();
      throw new Error(
        `@PersistedCollection class "${target.name}" must have exactly one @Id field.`,
      );
    }

    // Check that only one @Id was defined for this class
    if (globalPendingIdCount > 1) {
      resetGlobalState();
      throw new Error(
        `Multiple @Id decorators found in "${target.name}". A class can only have one @Id field.`,
      );
    }

    // Initialize metadata for this class
    const meta = {
      table,
      idProperty: globalPendingId.property,
      idColumn: globalPendingId.column,
      idType: globalPendingId.type,
      fields: new Map<string, CollectionFieldMeta>(),
      indices: [] as IndexMeta[],
    };

    // Consume pending fields accumulated by @Field decorators
    if (globalPendingFields) {
      for (const [property, def] of globalPendingFields) {
        meta.fields.set(property, {
          property,
          column: def.column,
          type: def.type,
        });
      }
      globalPendingFields = null;
    }

    // Consume pending indices accumulated by @Index decorators
    if (globalPendingIndices) {
      meta.indices = globalPendingIndices;
      globalPendingIndices = null;
    }

    // Clear pending id
    globalPendingId = null;
    globalPendingIdCount = 0;

    collectionMeta.set(target, meta);
    return target;
  };
}

/**
 * Mark a property as the primary key field.
 *
 * Each @PersistedCollection class must have exactly one @Id field.
 * The field type is inferred from the accompanying @Field decorator,
 * or defaults to 'string' if @Field is not present.
 *
 * @param type - The field type ('string' | 'number' | 'boolean' | 'date'), defaults to 'string'
 * @param options - Optional configuration (column name override)
 */
export function Id(type: FieldType = "string", options?: IdOptions) {
  return function (_target: undefined, context: unknown): void {
    const property = extractPropertyName(context);
    const column = options?.column ?? "id";

    // Track count to detect multiple @Id in same class
    globalPendingIdCount++;
    globalPendingId = { property, column, type };
  };
}

/**
 * Mark a property as a persisted field in a collection.
 *
 * @param type - The field type ('string' | 'number' | 'boolean' | 'date')
 * @param options - Optional field configuration (column name override)
 */
export function Field(type: FieldType, options?: FieldOptions) {
  return function (_target: undefined, context: unknown): void {
    const property = extractPropertyName(context);
    const column = options?.column ?? toSnakeCase(property);

    // Accumulate field definitions
    if (!globalPendingFields) {
      globalPendingFields = new Map();
    }
    globalPendingFields.set(property, { column, type });
  };
}

/**
 * Mark column(s) for indexing.
 *
 * Can be applied multiple times to create multiple indices.
 * When applied to a field, indexes that field. Can also specify
 * composite index columns explicitly.
 *
 * @param columns - Optional column names for composite index.
 *                  If omitted, indexes the decorated field only.
 *
 * @example
 * ```ts
 * // Single column index on email
 * @Field('string') @Index() email: string = '';
 *
 * // Composite index on [status, created_at]
 * @Field('string') @Index(['status', 'created_at']) status: string = '';
 * ```
 */
export function Index(columns?: string | string[]) {
  return function (_target: undefined, context: unknown): void {
    const property = extractPropertyName(context);
    const column = toSnakeCase(property);

    // Determine the columns to index
    let indexColumns: string[];
    if (columns === undefined) {
      // Index the decorated field only
      indexColumns = [column];
    } else if (typeof columns === "string") {
      // Single column specified
      indexColumns = [toSnakeCase(columns)];
    } else {
      // Array of columns
      indexColumns = columns.map(toSnakeCase);
    }

    // Accumulate index definitions
    if (!globalPendingIndices) {
      globalPendingIndices = [];
    }
    globalPendingIndices.push({ columns: indexColumns });
  };
}
