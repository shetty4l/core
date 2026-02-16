import { describe, expect, test } from "bun:test";
import { onShutdown } from "../src/signals";

describe("onShutdown", () => {
  test("registers handler without throwing", () => {
    // onShutdown registers process listeners — verify it doesn't throw.
    // We can't easily test signal delivery in unit tests, but we can
    // verify the function accepts valid inputs.
    expect(() => {
      onShutdown(() => {}, { signals: [] });
    }).not.toThrow();
  });

  test("accepts async cleanup function", () => {
    expect(() => {
      onShutdown(async () => {}, { signals: [] });
    }).not.toThrow();
  });

  test("accepts custom signals list", () => {
    expect(() => {
      onShutdown(() => {}, { signals: ["SIGUSR1"], timeoutMs: 1000 });
    }).not.toThrow();
  });
});
