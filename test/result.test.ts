import { describe, expect, test } from "bun:test";
import { err, ok } from "../src/result";

describe("ok", () => {
  test("creates Ok result", () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(42);
  });

  test("works with string values", () => {
    const result = ok("hello");
    expect(result.ok).toBe(true);
    expect(result.value).toBe("hello");
  });

  test("works with objects", () => {
    const result = ok({ name: "test" });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ name: "test" });
  });
});

describe("err", () => {
  test("creates Err result", () => {
    const result = err("something went wrong");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("something went wrong");
  });

  test("works with structured errors", () => {
    const result = err({ code: "NOT_FOUND", message: "missing" });
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({ code: "NOT_FOUND", message: "missing" });
  });
});

describe("type narrowing", () => {
  test("narrows Ok in conditional", () => {
    const result = ok(42);
    if (result.ok) {
      // TypeScript knows this is Ok<number>
      expect(result.value).toBe(42);
    } else {
      throw new Error("should not reach");
    }
  });

  test("narrows Err in conditional", () => {
    const result = err("bad");
    if (!result.ok) {
      // TypeScript knows this is Err<string>
      expect(result.error).toBe("bad");
    } else {
      throw new Error("should not reach");
    }
  });
});
