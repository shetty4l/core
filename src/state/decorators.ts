/**
 * TC39 decorators for state persistence.
 *
 * @example
 * ```ts
 * @Persisted('my_state')
 * class MyState {
 *   @Field() name: string = '';
 *   @Field({ type: 'date' }) createdAt: Date | null = null;
 * }
 * ```
 */

import {
  type ClassMeta,
  classMeta,
  type FieldMeta,
  type FieldType,
} from "./types";

/**
 * Convert camelCase to snake_case.
 */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Infer field type from a default value.
 * Returns undefined if type cannot be inferred (e.g., null).
 */
function inferType(value: unknown): FieldType | undefined {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value instanceof Date) return "date";
  return undefined;
}

/** Options for the @Field decorator. */
export interface FieldOptions {
  /** Explicit field type. Required when default is null. */
  type?: FieldType;
  /** Custom column name. Defaults to snake_case of property name. */
  column?: string;
}

/**
 * Mark a class as persisted to a SQLite table.
 *
 * @param table - SQLite table name
 * @throws Error if class extends another @Persisted class
 */
export function Persisted(table: string) {
  return function <T extends new (...args: unknown[]) => object>(
    target: T,
    _context: ClassDecoratorContext<T>,
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

    // Get or create metadata (fields may have been added by @Field)
    let meta = classMeta.get(target);
    if (!meta) {
      meta = { table, fields: new Map() };
      classMeta.set(target, meta);
    } else {
      meta.table = table;
    }

    return target;
  };
}

/**
 * Mark a property as a persisted field.
 *
 * Type is inferred from the default value. If default is null,
 * you must provide an explicit type option.
 *
 * @param options - Optional field configuration
 * @throws Error if type cannot be inferred and not explicitly provided
 */
export function Field(options?: FieldOptions) {
  return function <T>(
    _target: undefined,
    context: ClassFieldDecoratorContext<T>,
  ): void {
    const property = String(context.name);
    const column = options?.column ?? toSnakeCase(property);

    context.addInitializer(function (this: T) {
      const constructor = (this as object).constructor;

      // Get or create class metadata
      let meta = classMeta.get(constructor);
      if (!meta) {
        meta = { table: "", fields: new Map() };
        classMeta.set(constructor, meta);
      }

      // Skip if already registered (can happen with multiple instances)
      if (meta.fields.has(property)) {
        return;
      }

      // Get the default value from the instance
      const value = (this as Record<string, unknown>)[property];

      // Determine type
      let type = options?.type;
      if (!type) {
        type = inferType(value);
        if (!type) {
          throw new Error(
            `@Field on "${property}" has null default without explicit type. ` +
              `Use @Field({ type: 'string' | 'number' | 'boolean' | 'date' }) to specify the type.`,
          );
        }
      }

      const fieldMeta: FieldMeta = { property, column, type };
      meta.fields.set(property, fieldMeta);
    });
  };
}
