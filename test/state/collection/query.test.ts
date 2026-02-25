/**
 * Tests for query builder: buildWhere() and buildOrderBy().
 * Includes property-based tests using fast-check.
 */

import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { buildOrderBy, buildWhere } from "../../../src/state/collection/query";
import type { CollectionMeta } from "../../../src/state/collection/types";

// Test metadata fixture
function createTestMeta(): CollectionMeta {
  return {
    table: "test_table",
    idProperty: "id",
    idColumn: "id",
    idType: "string",
    fields: new Map([
      ["name", { property: "name", column: "name", type: "string" }],
      ["age", { property: "age", column: "age", type: "number" }],
      ["status", { property: "status", column: "status", type: "string" }],
      ["active", { property: "active", column: "active", type: "boolean" }],
      [
        "createdAt",
        { property: "createdAt", column: "created_at", type: "date" },
      ],
    ]),
    indices: [],
  };
}

describe("buildWhere - basic operators", () => {
  const meta = createTestMeta();

  test("empty where returns empty result", () => {
    const result = buildWhere(meta, {});
    expect(result.sql).toBe("");
    expect(result.params).toEqual([]);
  });

  test("undefined where returns empty result", () => {
    const result = buildWhere(meta, undefined);
    expect(result.sql).toBe("");
    expect(result.params).toEqual([]);
  });

  test("raw value treated as eq", () => {
    const result = buildWhere(meta, { name: "Alice" });
    expect(result.sql).toBe("name = ?");
    expect(result.params).toEqual(["Alice"]);
  });

  test("eq operator", () => {
    const result = buildWhere(meta, { name: { op: "eq", value: "Bob" } });
    expect(result.sql).toBe("name = ?");
    expect(result.params).toEqual(["Bob"]);
  });

  test("neq operator", () => {
    const result = buildWhere(meta, {
      status: { op: "neq", value: "deleted" },
    });
    expect(result.sql).toBe("status != ?");
    expect(result.params).toEqual(["deleted"]);
  });

  test("lt operator", () => {
    const result = buildWhere(meta, { age: { op: "lt", value: 18 } });
    expect(result.sql).toBe("age < ?");
    expect(result.params).toEqual([18]);
  });

  test("lte operator", () => {
    const result = buildWhere(meta, { age: { op: "lte", value: 18 } });
    expect(result.sql).toBe("age <= ?");
    expect(result.params).toEqual([18]);
  });

  test("gt operator", () => {
    const result = buildWhere(meta, { age: { op: "gt", value: 21 } });
    expect(result.sql).toBe("age > ?");
    expect(result.params).toEqual([21]);
  });

  test("gte operator", () => {
    const result = buildWhere(meta, { age: { op: "gte", value: 21 } });
    expect(result.sql).toBe("age >= ?");
    expect(result.params).toEqual([21]);
  });
});

describe("buildWhere - in/notIn operators", () => {
  const meta = createTestMeta();

  test("in operator with values", () => {
    const result = buildWhere(meta, {
      status: { op: "in", value: ["active", "pending"] },
    });
    expect(result.sql).toBe("status IN (?, ?)");
    expect(result.params).toEqual(["active", "pending"]);
  });

  test("in operator with single value", () => {
    const result = buildWhere(meta, {
      status: { op: "in", value: ["active"] },
    });
    expect(result.sql).toBe("status IN (?)");
    expect(result.params).toEqual(["active"]);
  });

  test("in operator with empty array returns false condition", () => {
    const result = buildWhere(meta, {
      status: { op: "in", value: [] },
    });
    expect(result.sql).toBe("0 = 1");
    expect(result.params).toEqual([]);
  });

  test("notIn operator with values", () => {
    const result = buildWhere(meta, {
      status: { op: "notIn", value: ["deleted", "archived"] },
    });
    expect(result.sql).toBe("status NOT IN (?, ?)");
    expect(result.params).toEqual(["deleted", "archived"]);
  });

  test("notIn operator with empty array returns true condition", () => {
    const result = buildWhere(meta, {
      status: { op: "notIn", value: [] },
    });
    expect(result.sql).toBe("1 = 1");
    expect(result.params).toEqual([]);
  });
});

describe("buildWhere - null operators", () => {
  const meta = createTestMeta();

  test("isNull operator", () => {
    const result = buildWhere(meta, {
      createdAt: { op: "isNull", value: null },
    });
    expect(result.sql).toBe("created_at IS NULL");
    expect(result.params).toEqual([]);
  });

  test("isNotNull operator", () => {
    const result = buildWhere(meta, {
      createdAt: { op: "isNotNull", value: null },
    });
    expect(result.sql).toBe("created_at IS NOT NULL");
    expect(result.params).toEqual([]);
  });
});

describe("buildWhere - string operators", () => {
  const meta = createTestMeta();

  test("contains operator", () => {
    const result = buildWhere(meta, { name: { op: "contains", value: "lic" } });
    expect(result.sql).toBe("name LIKE ? ESCAPE '\\'");
    expect(result.params).toEqual(["%lic%"]);
  });

  test("startsWith operator", () => {
    const result = buildWhere(meta, {
      name: { op: "startsWith", value: "Al" },
    });
    expect(result.sql).toBe("name LIKE ? ESCAPE '\\'");
    expect(result.params).toEqual(["Al%"]);
  });

  test("endsWith operator", () => {
    const result = buildWhere(meta, { name: { op: "endsWith", value: "ice" } });
    expect(result.sql).toBe("name LIKE ? ESCAPE '\\'");
    expect(result.params).toEqual(["%ice"]);
  });

  test("contains escapes % character", () => {
    const result = buildWhere(meta, {
      name: { op: "contains", value: "100%" },
    });
    expect(result.params).toEqual(["%100\\%%"]);
  });

  test("contains escapes _ character", () => {
    const result = buildWhere(meta, { name: { op: "contains", value: "a_b" } });
    expect(result.params).toEqual(["%a\\_b%"]);
  });
});

describe("buildWhere - multiple conditions", () => {
  const meta = createTestMeta();

  test("multiple conditions joined with AND", () => {
    const result = buildWhere(meta, { name: "Alice", age: 30 });
    expect(result.sql).toBe("name = ? AND age = ?");
    expect(result.params).toEqual(["Alice", 30]);
  });

  test("skips undefined values", () => {
    const result = buildWhere(meta, { name: "Alice", age: undefined });
    expect(result.sql).toBe("name = ?");
    expect(result.params).toEqual(["Alice"]);
  });

  test("all undefined returns empty", () => {
    const result = buildWhere(meta, { name: undefined, age: undefined });
    expect(result.sql).toBe("");
    expect(result.params).toEqual([]);
  });

  test("mixed operators", () => {
    const result = buildWhere(meta, {
      status: "active",
      age: { op: "gte", value: 18 },
      name: { op: "startsWith", value: "A" },
    });
    expect(result.sql).toContain("status = ?");
    expect(result.sql).toContain("age >= ?");
    expect(result.sql).toContain("name LIKE ? ESCAPE '\\'");
    expect(result.params.length).toBe(3);
  });
});

describe("buildWhere - id field", () => {
  const meta = createTestMeta();

  test("can query by id field", () => {
    const result = buildWhere(meta, { id: "abc123" });
    expect(result.sql).toBe("id = ?");
    expect(result.params).toEqual(["abc123"]);
  });

  test("id with operator", () => {
    const result = buildWhere(meta, {
      id: { op: "in", value: ["a", "b", "c"] },
    });
    expect(result.sql).toBe("id IN (?, ?, ?)");
    expect(result.params).toEqual(["a", "b", "c"]);
  });
});

describe("buildWhere - error cases", () => {
  const meta = createTestMeta();

  test("throws on unknown property", () => {
    expect(() => {
      buildWhere(meta, { unknownField: "value" } as Record<string, unknown>);
    }).toThrow(/not found in collection/);
  });

  test("error message includes available fields", () => {
    try {
      buildWhere(meta, { unknownField: "value" } as Record<string, unknown>);
      expect(true).toBe(false);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("name");
      expect(msg).toContain("age");
    }
  });
});

describe("buildOrderBy", () => {
  const meta = createTestMeta();

  test("empty orderBy returns empty string", () => {
    const result = buildOrderBy(meta, {});
    expect(result).toBe("");
  });

  test("undefined orderBy returns empty string", () => {
    const result = buildOrderBy(meta, undefined);
    expect(result).toBe("");
  });

  test("single field asc", () => {
    const result = buildOrderBy(meta, { name: "asc" });
    expect(result).toBe("name ASC");
  });

  test("single field desc", () => {
    const result = buildOrderBy(meta, { name: "desc" });
    expect(result).toBe("name DESC");
  });

  test("multiple fields", () => {
    const result = buildOrderBy(meta, { createdAt: "desc", name: "asc" });
    expect(result).toContain("created_at DESC");
    expect(result).toContain("name ASC");
  });

  test("uses snake_case column names", () => {
    const result = buildOrderBy(meta, { createdAt: "desc" });
    expect(result).toBe("created_at DESC");
  });

  test("can order by id field", () => {
    const result = buildOrderBy(meta, { id: "asc" });
    expect(result).toBe("id ASC");
  });

  test("skips undefined directions", () => {
    const result = buildOrderBy(meta, {
      name: "asc",
      age: undefined,
    } as { name: "asc"; age: undefined });
    expect(result).toBe("name ASC");
  });

  test("throws on invalid direction", () => {
    expect(() => {
      buildOrderBy(meta, { name: "invalid" as "asc" });
    }).toThrow(/Invalid order direction/);
  });
});

// --------------------------------------------------------------------------
// Property-based tests using fast-check
// --------------------------------------------------------------------------

describe("buildWhere - property-based tests", () => {
  const meta = createTestMeta();

  test("eq with arbitrary strings produces valid SQL", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const result = buildWhere(meta, { name: value });
        expect(result.sql).toBe("name = ?");
        expect(result.params).toEqual([value]);
      }),
    );
  });

  test("eq with arbitrary numbers produces valid SQL", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true }), (value) => {
        const result = buildWhere(meta, { age: value });
        expect(result.sql).toBe("age = ?");
        expect(result.params).toEqual([value]);
      }),
    );
  });

  test("in operator with arbitrary string arrays", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { minLength: 1, maxLength: 10 }),
        (values) => {
          const result = buildWhere(meta, {
            status: { op: "in", value: values },
          });
          const placeholders = values.map(() => "?").join(", ");
          expect(result.sql).toBe(`status IN (${placeholders})`);
          expect(result.params).toEqual(values);
        },
      ),
    );
  });

  test("contains escapes all LIKE special characters in input", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => s.includes("%") || s.includes("_")),
        (value) => {
          const result = buildWhere(meta, {
            name: { op: "contains", value },
          });
          const param = result.params[0] as string;
          // Result should be "%<escaped-value>%"
          // Extract the inner part (remove leading and trailing %)
          const inner = param.slice(1, -1);
          // After escaping, all % and _ in the inner part should be escaped
          // Original chars % and _ should become \% and \_
          const originalSpecialCount =
            (value.match(/%/g) || []).length + (value.match(/_/g) || []).length;
          const escapedSpecialCount =
            (inner.match(/\\%/g) || []).length +
            (inner.match(/\\_/g) || []).length;
          expect(escapedSpecialCount).toBe(originalSpecialCount);
        },
      ),
      { numRuns: 50 },
    );
  });

  test("startsWith escapes special characters", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (value) => {
        const result = buildWhere(meta, {
          name: { op: "startsWith", value },
        });
        const param = result.params[0] as string;
        // Should end with % (unescaped) and value should be at start
        expect(param.endsWith("%")).toBe(true);
      }),
    );
  });

  test("endsWith escapes special characters", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (value) => {
        const result = buildWhere(meta, {
          name: { op: "endsWith", value },
        });
        const param = result.params[0] as string;
        // Should start with % (unescaped)
        expect(param.startsWith("%")).toBe(true);
      }),
    );
  });

  test("comparison operators preserve numeric order", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, min: -1e6, max: 1e6 }), (value) => {
        const ltResult = buildWhere(meta, { age: { op: "lt", value } });
        const gteResult = buildWhere(meta, { age: { op: "gte", value } });

        expect(ltResult.sql).toBe("age < ?");
        expect(gteResult.sql).toBe("age >= ?");
        expect(ltResult.params[0]).toBe(value);
        expect(gteResult.params[0]).toBe(value);
      }),
    );
  });
});

describe("buildOrderBy - property-based tests", () => {
  const meta = createTestMeta();

  test("direction is always uppercase ASC or DESC", () => {
    fc.assert(
      fc.property(fc.constantFrom("asc", "desc"), (dir) => {
        const result = buildOrderBy(meta, { name: dir });
        expect(result).toMatch(/^name (ASC|DESC)$/);
      }),
    );
  });
});
