import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
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

afterAll(() => teardown());

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

  test("restart succeeds even when service is not running", async () => {
    const configDir = setup();
    // Create a minimal script that starts and stays alive
    const script = join(configDir, "serve.ts");
    writeFileSync(
      script,
      `Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() { return Response.json({ status: "healthy", uptime: 0 }); } });`,
    );

    const manager = createDaemonManager({
      name: "test",
      configDir,
      cliPath: script,
      serveCommand: "", // script is self-contained, no subcommand
      startupPollMs: 100,
      healthTimeoutMs: 3000,
      // No healthUrl — fall back to PID check
    });

    try {
      // restart when nothing is running should still start
      const result = await manager.restart();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.running).toBe(true);
        expect(result.value.pid).toBeGreaterThan(0);
      }
    } finally {
      await manager.stop();
      teardown();
    }
  });

  test("start with healthUrl polls until healthy", async () => {
    const configDir = setup();
    const port = 19876 + Math.floor(Math.random() * 1000);

    // Script that starts an HTTP server
    const script = join(configDir, "serve.ts");
    writeFileSync(
      script,
      `Bun.serve({ port: ${port}, hostname: "127.0.0.1", fetch() { return Response.json({ status: "healthy", uptime: 1 }); } });`,
    );

    const manager = createDaemonManager({
      name: "test",
      configDir,
      cliPath: script,
      serveCommand: "",
      healthUrl: `http://127.0.0.1:${port}/health`,
      startupPollMs: 100,
      healthTimeoutMs: 5000,
    });

    try {
      const result = await manager.start();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.running).toBe(true);
        expect(result.value.pid).toBeGreaterThan(0);
      }
    } finally {
      await manager.stop();
      teardown();
    }
  });

  test("start returns error when process exits during startup", async () => {
    const configDir = setup();

    // Script that exits immediately
    const script = join(configDir, "serve.ts");
    writeFileSync(script, "process.exit(1);");

    const manager = createDaemonManager({
      name: "test",
      configDir,
      cliPath: script,
      serveCommand: "",
      healthUrl: "http://127.0.0.1:19999/health",
      startupPollMs: 100,
      healthTimeoutMs: 2000,
    });

    try {
      const result = await manager.start();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("process exited during startup");
      }
      // PID file should be cleaned up
      expect(existsSync(join(configDir, "test.pid"))).toBe(false);
    } finally {
      teardown();
    }
  });

  test("stop sends SIGTERM and waits for process to exit", async () => {
    const configDir = setup();
    const port = 19876 + Math.floor(Math.random() * 1000);

    const script = join(configDir, "serve.ts");
    writeFileSync(
      script,
      `
      const s = Bun.serve({ port: ${port}, hostname: "127.0.0.1", fetch() { return Response.json({ status: "healthy", uptime: 0 }); } });
      process.on("SIGTERM", () => { s.stop(); process.exit(0); });
      `,
    );

    const manager = createDaemonManager({
      name: "test",
      configDir,
      cliPath: script,
      serveCommand: "",
      healthUrl: `http://127.0.0.1:${port}/health`,
      startupPollMs: 100,
      healthTimeoutMs: 5000,
    });

    try {
      const startResult = await manager.start();
      expect(startResult.ok).toBe(true);

      const stopResult = await manager.stop();
      expect(stopResult.ok).toBe(true);
      if (stopResult.ok) {
        expect(stopResult.value.running).toBe(false);
        expect(stopResult.value.pid).toBeGreaterThan(0);
      }

      // PID file should be removed
      expect(existsSync(join(configDir, "test.pid"))).toBe(false);
    } finally {
      teardown();
    }
  });

  test("restart stops then starts with delay", async () => {
    const configDir = setup();
    const port = 19876 + Math.floor(Math.random() * 1000);

    const script = join(configDir, "serve.ts");
    writeFileSync(
      script,
      `
      const s = Bun.serve({ port: ${port}, hostname: "127.0.0.1", fetch() { return Response.json({ status: "healthy", uptime: 0 }); } });
      process.on("SIGTERM", () => { s.stop(); process.exit(0); });
      `,
    );

    const manager = createDaemonManager({
      name: "test",
      configDir,
      cliPath: script,
      serveCommand: "",
      healthUrl: `http://127.0.0.1:${port}/health`,
      startupPollMs: 200,
      healthTimeoutMs: 5000,
    });

    try {
      // Start first instance
      const startResult = await manager.start();
      expect(startResult.ok).toBe(true);
      const oldPid = startResult.ok ? startResult.value.pid : undefined;

      // Restart — should stop old, delay, start new
      const restartResult = await manager.restart();
      expect(restartResult.ok).toBe(true);
      if (restartResult.ok) {
        expect(restartResult.value.running).toBe(true);
        // New PID should differ from old
        expect(restartResult.value.pid).not.toBe(oldPid);
      }
    } finally {
      await manager.stop();
      teardown();
    }
  });

  test("rotates existing log file to .old on start", async () => {
    const configDir = setup();
    const port = 19876 + Math.floor(Math.random() * 1000);

    // Seed the log file with previous content
    const logFile = join(configDir, "test.log");
    const oldLogFile = join(configDir, "test.log.old");
    writeFileSync(logFile, "previous session logs\n");

    const script = join(configDir, "serve.ts");
    writeFileSync(
      script,
      `
      console.error("new session started");
      const s = Bun.serve({ port: ${port}, hostname: "127.0.0.1", fetch() { return Response.json({ status: "healthy", uptime: 0 }); } });
      process.on("SIGTERM", () => { s.stop(); process.exit(0); });
      `,
    );

    const manager = createDaemonManager({
      name: "test",
      configDir,
      cliPath: script,
      serveCommand: "",
      healthUrl: `http://127.0.0.1:${port}/health`,
      startupPollMs: 100,
      healthTimeoutMs: 5000,
    });

    try {
      const result = await manager.start();
      expect(result.ok).toBe(true);

      // Give the child a moment to flush stderr
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Old log should be rotated
      expect(existsSync(oldLogFile)).toBe(true);
      const oldContent = readFileSync(oldLogFile, "utf-8");
      expect(oldContent).toContain("previous session logs");

      // New log should only have new content
      const newContent = readFileSync(logFile, "utf-8");
      expect(newContent).toContain("new session started");
      expect(newContent).not.toContain("previous session logs");
    } finally {
      await manager.stop();
      teardown();
    }
  });

  test("log file captures child output via append mode", async () => {
    const configDir = setup();
    const port = 19876 + Math.floor(Math.random() * 1000);

    // Script that writes multiple lines to stderr then serves
    const script = join(configDir, "serve.ts");
    writeFileSync(
      script,
      `
      console.error("line one");
      console.error("line two");
      const s = Bun.serve({ port: ${port}, hostname: "127.0.0.1", fetch() { return Response.json({ status: "healthy", uptime: 0 }); } });
      process.on("SIGTERM", () => { s.stop(); process.exit(0); });
      `,
    );

    const manager = createDaemonManager({
      name: "test",
      configDir,
      cliPath: script,
      serveCommand: "",
      healthUrl: `http://127.0.0.1:${port}/health`,
      startupPollMs: 100,
      healthTimeoutMs: 5000,
    });

    try {
      const result = await manager.start();
      expect(result.ok).toBe(true);

      // Give the child a moment to flush stderr
      await new Promise((resolve) => setTimeout(resolve, 200));

      const logFile = join(configDir, "test.log");
      const content = readFileSync(logFile, "utf-8");
      // Both lines must be captured via append mode
      expect(content).toContain("line one");
      expect(content).toContain("line two");
      expect(content.indexOf("line one")).toBeLessThan(
        content.indexOf("line two"),
      );
    } finally {
      await manager.stop();
      teardown();
    }
  });
});
