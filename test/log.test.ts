import { describe, expect, test } from "bun:test";
import { createLogger } from "../src/log";

describe("createLogger", () => {
  test("returns a function", () => {
    const log = createLogger("test");
    expect(typeof log).toBe("function");
  });

  test("outputs [timestamp] name: message format", () => {
    const output: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => output.push(args.join(" "));

    try {
      const log = createLogger("cortex");
      log("processing loop started");

      expect(output).toHaveLength(1);
      // Should match: [ISO timestamp] cortex: processing loop started
      expect(output[0]).toMatch(
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\] cortex: processing loop started$/,
      );
    } finally {
      console.error = origError;
    }
  });

  test("uses the provided service name", () => {
    const output: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => output.push(args.join(" "));

    try {
      const log = createLogger("synapse");
      log("hello");
      expect(output[0]).toContain("synapse: hello");
    } finally {
      console.error = origError;
    }
  });

  test("each call gets a fresh timestamp", async () => {
    const output: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => output.push(args.join(" "));

    try {
      const log = createLogger("test");
      log("first");
      await new Promise((resolve) => setTimeout(resolve, 10));
      log("second");

      expect(output).toHaveLength(2);
      // Extract timestamps
      const ts1 = output[0].slice(1, 25);
      const ts2 = output[1].slice(1, 25);
      expect(new Date(ts1).getTime()).toBeLessThanOrEqual(
        new Date(ts2).getTime(),
      );
    } finally {
      console.error = origError;
    }
  });
});
