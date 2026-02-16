import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import type { DaemonManager } from "../src/daemon";
import { createDaemonManager } from "../src/daemon";

const TMP = join(import.meta.dir, ".tmp-daemon");

function setup(): string {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(TMP, { recursive: true });
  return TMP;
}

function teardown() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
}

describe("createDaemonManager", () => {
  test("creates a manager with all methods", () => {
    const configDir = setup();
    try {
      const manager = createDaemonManager({
        name: "test",
        configDir,
        cliPath: "/nonexistent/cli.ts",
      });
      expect(typeof manager.start).toBe("function");
      expect(typeof manager.stop).toBe("function");
      expect(typeof manager.restart).toBe("function");
      expect(typeof manager.status).toBe("function");
    } finally {
      teardown();
    }
  });

  test("status returns not running when no PID file", async () => {
    const configDir = setup();
    try {
      const manager = createDaemonManager({
        name: "test",
        configDir,
        cliPath: "/nonexistent/cli.ts",
      });
      const status = await manager.status();
      expect(status.running).toBe(false);
      expect(status.pid).toBeUndefined();
    } finally {
      teardown();
    }
  });

  test("status cleans up stale PID file", async () => {
    const configDir = setup();
    try {
      // Write a PID that doesn't correspond to a running process
      writeFileSync(join(configDir, "test.pid"), "999999");

      const manager = createDaemonManager({
        name: "test",
        configDir,
        cliPath: "/nonexistent/cli.ts",
      });
      const status = await manager.status();
      expect(status.running).toBe(false);

      // PID file should be cleaned up
      expect(existsSync(join(configDir, "test.pid"))).toBe(false);
    } finally {
      teardown();
    }
  });

  test("stop returns err when not running", async () => {
    const configDir = setup();
    try {
      const manager = createDaemonManager({
        name: "test",
        configDir,
        cliPath: "/nonexistent/cli.ts",
      });
      const result = await manager.stop();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("not running");
    } finally {
      teardown();
    }
  });
});
