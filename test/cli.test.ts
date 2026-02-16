import { describe, expect, test } from "bun:test";
import { formatUptime, parseArgs } from "../src/cli";

// --- parseArgs ---

describe("parseArgs", () => {
  test("extracts command and args", () => {
    const result = parseArgs(["start", "--port", "8080"]);
    expect(result.command).toBe("start");
    expect(result.args).toEqual(["--port", "8080"]);
    expect(result.json).toBe(false);
  });

  test("strips --json flag", () => {
    const result = parseArgs(["status", "--json"]);
    expect(result.command).toBe("status");
    expect(result.args).toEqual([]);
    expect(result.json).toBe(true);
  });

  test("--json can appear anywhere", () => {
    const result = parseArgs(["--json", "health"]);
    expect(result.command).toBe("health");
    expect(result.json).toBe(true);
  });

  test("defaults to help when empty", () => {
    const result = parseArgs([]);
    expect(result.command).toBe("help");
    expect(result.args).toEqual([]);
    expect(result.json).toBe(false);
  });
});

// --- formatUptime ---

describe("formatUptime", () => {
  test("formats seconds", () => {
    expect(formatUptime(45)).toBe("45s");
  });

  test("formats minutes and seconds", () => {
    expect(formatUptime(192)).toBe("3m 12s");
  });

  test("formats hours and minutes", () => {
    expect(formatUptime(8100)).toBe("2h 15m");
  });

  test("edge case: exactly 60 seconds", () => {
    expect(formatUptime(60)).toBe("1m 0s");
  });

  test("edge case: exactly 1 hour", () => {
    expect(formatUptime(3600)).toBe("1h 0m");
  });

  test("zero seconds", () => {
    expect(formatUptime(0)).toBe("0s");
  });
});
