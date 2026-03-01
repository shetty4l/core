/**
 * TC39 decorators for state persistence.
 *
 * Uses explicit type specification for all fields to ensure correct
 * serialization without relying on runtime type inference.
 *
 * Note: Field decorators run before class decorator, which allows
 * global accumulation of field definitions.
 *
 * @example
 * ```ts
 * @Persisted('my_state')
 * class MyState {
 *   @Field('string') name: string = '';
 *   @Field('date') createdAt: Date | null = null;
 *   @Field('number') count: number = 0;
 *   @Field('boolean') enabled: boolean = true;
 * }
 * ```
 */

import { classMeta, type FieldMeta, type FieldType } from "./types";

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

type PendingFieldDef = { column: string; type: FieldType };
type PendingFieldsMap = Map<string, PendingFieldDef>;

// Global accumulator for pending field definitions.
// In Bun's TC39 implementation, @Field decorators run synchronously
// before the @Persisted decorator for the same class.
let globalPendingFields: PendingFieldsMap | null = null;

/**
 * Mark a class as persisted to a SQLite table.
 *
 * @param table - SQLite table name
 * @throws Error if class extends another @Persisted class
 */
export function Persisted(table: string) {
  // Bun's TC39 decorator: context is undefined, not ClassDecoratorContext
  return function <T extends new (...args: unknown[]) => object>(
    target: T,
    _context: unknown,
  ): T {
    // Check prototype chain for existing @Persisted class
    let proto = Object.getPrototypeOf(target);
    while (proto && proto !== Function.prototype) {
      if (classMeta.has(proto)) {
        const parentMeta = classMeta.get(proto)!;
        throw new Error(
          `@Persisted class "${target.name}" cannot extend @Persisted class "${proto.name}" (table: "${parentMeta.table}"). ` +
            `State classes do not support inheritance.`,
        );
      }
      proto = Object.getPrototypeOf(proto);
    }

    // Initialize metadata for this class
    const meta = { table, fields: new Map<string, FieldMeta>() };

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

    classMeta.set(target, meta);
    return target;
  };
}

/**
 * Mark a property as a persisted field.
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
