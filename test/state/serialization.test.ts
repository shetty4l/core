/**
 * Tests for serialization utilities.
 */

import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  deserializeValue,
  serializeValue,
  sqliteType,
} from "../../src/state/serialization";

describe("serializeValue", () => {
  test("serializes string", () => {
    expect(serializeValue("hello", "string")).toBe("hello");
  });

  test("serializes empty string", () => {
    expect(serializeValue("", "string")).toBe("");
  });

  test("serializes number", () => {
    expect(serializeValue(42, "number")).toBe(42);
  });

  test("serializes zero", () => {
    expect(serializeValue(0, "number")).toBe(0);
  });

  test("serializes negative number", () => {
    expect(serializeValue(-3.14, "number")).toBe(-3.14);
  });

  test("serializes boolean true", () => {
    expect(serializeValue(true, "boolean")).toBe(1);
  });

  test("serializes boolean false", () => {
    expect(serializeValue(false, "boolean")).toBe(0);
  });

  test("serializes Date", () => {
    const date = new Date("2024-01-15T12:30:00.000Z");
    expect(serializeValue(date, "date")).toBe("2024-01-15T12:30:00.000Z");
  });

  test("serializes null for string type", () => {
    expect(serializeValue(null, "string")).toBe(null);
  });

  test("serializes null for number type", () => {
    expect(serializeValue(null, "number")).toBe(null);
  });

  test("serializes null for boolean type", () => {
    expect(serializeValue(null, "boolean")).toBe(null);
  });

  test("serializes null for date type", () => {
    expect(serializeValue(null, "date")).toBe(null);
  });

  test("serializes undefined as null", () => {
    expect(serializeValue(undefined, "string")).toBe(null);
  });

  test("throws on NaN", () => {
    expect(() => serializeValue(Number.NaN, "number")).toThrow(/NaN/);
  });

  test("NaN error message is clear", () => {
    try {
      serializeValue(Number.NaN, "number");
      expect(true).toBe(false);
    } catch (e) {
      expect((e as Error).message).toContain("valid number");
    }
  });

  test("throws on Infinity", () => {
    expect(() => serializeValue(Number.POSITIVE_INFINITY, "number")).toThrow(
      /Infinity/,
    );
  });

  test("throws on negative Infinity", () => {
    expect(() => serializeValue(Number.NEGATIVE_INFINITY, "number")).toThrow(
      /Infinity/,
    );
  });

  test("Infinity error message is clear", () => {
    try {
      serializeValue(Number.POSITIVE_INFINITY, "number");
      expect(true).toBe(false);
    } catch (e) {
      expect((e as Error).message).toContain("finite number");
    }
  });
});

describe("deserializeValue", () => {
  test("deserializes string", () => {
    expect(deserializeValue("hello", "string")).toBe("hello");
  });

  test("deserializes empty string", () => {
    expect(deserializeValue("", "string")).toBe("");
  });

  test("deserializes number", () => {
    expect(deserializeValue(42, "number")).toBe(42);
  });

  test("deserializes zero", () => {
    expect(deserializeValue(0, "number")).toBe(0);
  });

  test("deserializes boolean from 1", () => {
    expect(deserializeValue(1, "boolean")).toBe(true);
  });

  test("deserializes boolean from 0", () => {
    expect(deserializeValue(0, "boolean")).toBe(false);
  });

  test("deserializes boolean from true", () => {
    expect(deserializeValue(true, "boolean")).toBe(true);
  });

  test("deserializes boolean from false", () => {
    expect(deserializeValue(false, "boolean")).toBe(false);
  });

  test("deserializes Date from ISO string", () => {
    const result = deserializeValue("2024-01-15T12:30:00.000Z", "date");
    expect(result).toBeInstanceOf(Date);
    expect((result as Date).toISOString()).toBe("2024-01-15T12:30:00.000Z");
  });

  test("deserializes null for string type", () => {
    expect(deserializeValue(null, "string")).toBe(null);
  });

  test("deserializes null for number type", () => {
    expect(deserializeValue(null, "number")).toBe(null);
  });

  test("deserializes null for boolean type", () => {
    expect(deserializeValue(null, "boolean")).toBe(null);
  });

  test("deserializes null for date type", () => {
    expect(deserializeValue(null, "date")).toBe(null);
  });

  test("deserializes undefined as null", () => {
    expect(deserializeValue(undefined, "string")).toBe(null);
  });
});

describe("roundtrip", () => {
  test("string roundtrip", () => {
    const original = "test string";
    const serialized = serializeValue(original, "string");
    const deserialized = deserializeValue(serialized, "string");
    expect(deserialized).toBe(original);
  });

  test("number roundtrip", () => {
    const original = 123.456;
    const serialized = serializeValue(original, "number");
    const deserialized = deserializeValue(serialized, "number");
    expect(deserialized).toBe(original);
  });

  test("boolean true roundtrip", () => {
    const original = true;
    const serialized = serializeValue(original, "boolean");
    const deserialized = deserializeValue(serialized, "boolean");
    expect(deserialized).toBe(original);
  });

  test("boolean false roundtrip", () => {
    const original = false;
    const serialized = serializeValue(original, "boolean");
    const deserialized = deserializeValue(serialized, "boolean");
    expect(deserialized).toBe(original);
  });

  test("date roundtrip", () => {
    const original = new Date("2024-06-15T08:00:00.000Z");
    const serialized = serializeValue(original, "date");
    const deserialized = deserializeValue(serialized, "date") as Date;
    expect(deserialized.getTime()).toBe(original.getTime());
  });

  test("null roundtrip for all types", () => {
    for (const type of ["string", "number", "boolean", "date"] as const) {
      const serialized = serializeValue(null, type);
      const deserialized = deserializeValue(serialized, type);
      expect(deserialized).toBe(null);
    }
  });
});

describe("property-based tests", () => {
  test("string roundtrip (fast-check)", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const serialized = serializeValue(s, "string");
        const deserialized = deserializeValue(serialized, "string");
        return deserialized === s;
      }),
    );
  });

  test("number roundtrip (fast-check)", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (n) => {
        const serialized = serializeValue(n, "number");
        const deserialized = deserializeValue(serialized, "number");
        return deserialized === n;
      }),
    );
  });

  test("date roundtrip (fast-check)", () => {
    fc.assert(
      fc.property(
        fc
          .date({ min: new Date(0), max: new Date("2100-01-01") })
          .filter((d) => !Number.isNaN(d.getTime())),
        (d) => {
          const serialized = serializeValue(d, "date");
          const deserialized = deserializeValue(serialized, "date") as Date;
          return deserialized.getTime() === d.getTime();
        },
      ),
    );
  });

  test("boolean roundtrip (fast-check)", () => {
    fc.assert(
      fc.property(fc.boolean(), (b) => {
        const serialized = serializeValue(b, "boolean");
        const deserialized = deserializeValue(serialized, "boolean");
        return deserialized === b;
      }),
    );
  });
});

describe("sqliteType", () => {
  test("string maps to TEXT", () => {
    expect(sqliteType("string")).toBe("TEXT");
  });

  test("date maps to TEXT", () => {
    expect(sqliteType("date")).toBe("TEXT");
  });

  test("number maps to REAL", () => {
    expect(sqliteType("number")).toBe("REAL");
  });

  test("boolean maps to INTEGER", () => {
    expect(sqliteType("boolean")).toBe("INTEGER");
  });
});
