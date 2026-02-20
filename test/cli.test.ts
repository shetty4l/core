import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createDaemonCommands,
  createHealthCommand,
  createLogsCommand,
  formatUptime,
  parseArgs,
} from "../src/cli";
import type { DaemonManager, DaemonStatus } from "../src/daemon";
import type { Result } from "../src/result";
import { err, ok } from "../src/result";

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

// --- createLogsCommand ---

describe("createLogsCommand", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cli-logs-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty message when file does not exist", async () => {
    const handler = createLogsCommand({
      logFile: join(tmpDir, "nonexistent.log"),
    });
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      const code = await handler([], false);
      expect(code).toBe(0);
      expect(logs).toEqual(["No log entries yet."]);
    } finally {
      console.log = origLog;
    }
  });

  test("returns custom empty message", async () => {
    const handler = createLogsCommand({
      logFile: join(tmpDir, "nonexistent.log"),
      emptyMessage: "Nothing here.",
    });
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      await handler([], false);
      expect(logs).toEqual(["Nothing here."]);
    } finally {
      console.log = origLog;
    }
  });

  test("tails last N lines", async () => {
    const logFile = join(tmpDir, "tail.log");
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    await Bun.write(logFile, lines.join("\n") + "\n");

    const handler = createLogsCommand({ logFile });
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      const code = await handler(["5"], false);
      expect(code).toBe(0);
      expect(output).toEqual([
        "line 46",
        "line 47",
        "line 48",
        "line 49",
        "line 50",
      ]);
    } finally {
      console.log = origLog;
    }
  });

  test("uses defaultCount when no arg provided", async () => {
    const logFile = join(tmpDir, "default.log");
    const lines = Array.from({ length: 30 }, (_, i) => `entry ${i + 1}`);
    await Bun.write(logFile, lines.join("\n") + "\n");

    const handler = createLogsCommand({ logFile, defaultCount: 3 });
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      await handler([], false);
      expect(output).toEqual(["entry 28", "entry 29", "entry 30"]);
    } finally {
      console.log = origLog;
    }
  });

  test("json output includes lines, file, and total", async () => {
    const logFile = join(tmpDir, "json.log");
    await Bun.write(logFile, "alpha\nbeta\ngamma\n");

    const handler = createLogsCommand({ logFile });
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      const code = await handler(["2"], true);
      expect(code).toBe(0);
      const parsed = JSON.parse(output[0]);
      expect(parsed.lines).toEqual(["beta", "gamma"]);
      expect(parsed.file).toBe(logFile);
      expect(parsed.total).toBe(3);
    } finally {
      console.log = origLog;
    }
  });

  test("json output for missing file returns empty lines", async () => {
    const handler = createLogsCommand({
      logFile: join(tmpDir, "missing.log"),
    });
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      const code = await handler([], true);
      expect(code).toBe(0);
      const parsed = JSON.parse(output[0]);
      expect(parsed.lines).toEqual([]);
      expect(parsed.file).toContain("missing.log");
    } finally {
      console.log = origLog;
    }
  });

  test("returns 1 for invalid count", async () => {
    const handler = createLogsCommand({
      logFile: join(tmpDir, "any.log"),
    });
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    try {
      const code = await handler(["abc"], false);
      expect(code).toBe(1);
      expect(errors[0]).toContain("Invalid count");
    } finally {
      console.error = origError;
    }
  });

  test("strips null bytes from log file content", async () => {
    const logFile = join(tmpDir, "nullbytes.log");
    // Simulate corrupted log with null bytes interspersed
    await Bun.write(logFile, "clean line\n\0\0corrupt\0ed line\n\0\0\0\n");

    const handler = createLogsCommand({ logFile });
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      const code = await handler(["10"], false);
      expect(code).toBe(0);
      expect(output).toEqual(["clean line", "corrupted line"]);
      // No null bytes in output
      for (const line of output) {
        expect(line).not.toContain("\0");
      }
    } finally {
      console.log = origLog;
    }
  });

  test("strips null bytes in json mode", async () => {
    const logFile = join(tmpDir, "nulljson.log");
    await Bun.write(logFile, "good\n\0bad\0line\n");

    const handler = createLogsCommand({ logFile });
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      const code = await handler(["10"], true);
      expect(code).toBe(0);
      const parsed = JSON.parse(output[0]);
      expect(parsed.lines).toEqual(["good", "badline"]);
    } finally {
      console.log = origLog;
    }
  });
});

// --- runCli (subprocess tests) ---

/**
 * Helper: write a temp .ts script and run it via Bun subprocess.
 * Returns stdout, stderr, exitCode, and whether the process was killed by timeout.
 */
async function runCliSubprocess(
  argv: string[],
  handler: string,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}> {
  const cliPath = join(import.meta.dir, "../src/cli.ts");
  const script = `
    import { runCli } from "${cliPath}";
    process.argv = ["bun", "test", ${argv.map((a) => JSON.stringify(a)).join(", ")}];
    runCli({
      name: "test-cli",
      version: "1.0.0",
      help: "Test help text",
      commands: { ${handler} },
    });
  `;

  const tmpFile = join(import.meta.dir, `_cli_test_${Date.now()}.ts`);
  await Bun.write(tmpFile, script);

  try {
    const proc = Bun.spawn(["bun", "run", tmpFile], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeout = 2000;
    const timer = setTimeout(() => proc.kill(), timeout);

    const exitCode = await proc.exited;
    clearTimeout(timer);

    return {
      stdout: await new Response(proc.stdout).text(),
      stderr: await new Response(proc.stderr).text(),
      exitCode,
      timedOut: proc.signalCode !== null,
    };
  } finally {
    const { unlinkSync } = await import("fs");
    try {
      unlinkSync(tmpFile);
    } catch {}
  }
}

describe("runCli", () => {
  test("exits with handler return code", async () => {
    const result = await runCliSubprocess(["greet"], "greet: () => 0");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  test("exits with nonzero handler return code", async () => {
    const result = await runCliSubprocess(["fail"], "fail: () => 1");
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  test("stays alive when handler returns void", async () => {
    // Handler returns void but keeps event loop alive (like Bun.serve would).
    // We use a timeout to confirm the process stays alive.
    const result = await runCliSubprocess(
      ["serve"],
      "serve: () => { setInterval(() => {}, 60000); }",
    );
    // The process was killed by our timeout, meaning it stayed alive
    expect(result.timedOut).toBe(true);
  });

  test("exits 0 for --version", async () => {
    const result = await runCliSubprocess(["--version"], "noop: () => 0");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("1.0.0");
  });

  test("exits 1 for unknown command", async () => {
    const result = await runCliSubprocess(["bogus"], "noop: () => 0");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown command");
  });
});

// --- createDaemonCommands ---

/** Helper to capture console.log and console.error output. */
function captureConsole(): {
  logs: string[];
  errors: string[];
  restore: () => void;
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  console.error = (...args: unknown[]) => errors.push(args.join(" "));
  return {
    logs,
    errors,
    restore: () => {
      console.log = origLog;
      console.error = origError;
    },
  };
}

function mockDaemon(overrides: Partial<DaemonManager> = {}): DaemonManager {
  return {
    start: async () => ok({ running: true, pid: 1234, port: 8080 }),
    stop: async () => ok({ running: false, pid: 1234 }),
    restart: async () => ok({ running: true, pid: 5678, port: 8080 }),
    status: async () => ({ running: true, pid: 1234, port: 8080, uptime: 120 }),
    ...overrides,
  };
}

describe("createDaemonCommands", () => {
  test("start — success with port", async () => {
    const cmds = createDaemonCommands({
      name: "test",
      getDaemon: () => mockDaemon(),
    });
    const out = captureConsole();
    try {
      const code = await cmds.start([], false);
      expect(code).toBe(0);
      expect(out.logs[0]).toBe("test daemon started (PID: 1234, port: 8080)");
    } finally {
      out.restore();
    }
  });

  test("start — success without port", async () => {
    const cmds = createDaemonCommands({
      name: "test",
      getDaemon: () =>
        mockDaemon({
          start: async () => ok({ running: true, pid: 1234 }),
        }),
    });
    const out = captureConsole();
    try {
      const code = await cmds.start([], false);
      expect(code).toBe(0);
      expect(out.logs[0]).toBe("test daemon started (PID: 1234)");
    } finally {
      out.restore();
    }
  });

  test("start — error", async () => {
    const cmds = createDaemonCommands({
      name: "test",
      getDaemon: () =>
        mockDaemon({
          start: async () => err("test: already running (PID 999)"),
        }),
    });
    const out = captureConsole();
    try {
      const code = await cmds.start([], false);
      expect(code).toBe(1);
      expect(out.errors[0]).toContain("already running");
    } finally {
      out.restore();
    }
  });

  test("stop — success", async () => {
    const cmds = createDaemonCommands({
      name: "test",
      getDaemon: () => mockDaemon(),
    });
    const out = captureConsole();
    try {
      const code = await cmds.stop([], false);
      expect(code).toBe(0);
      expect(out.logs[0]).toBe("test daemon stopped (was PID: 1234)");
    } finally {
      out.restore();
    }
  });

  test("stop — not running shows friendly message", async () => {
    const cmds = createDaemonCommands({
      name: "test",
      getDaemon: () =>
        mockDaemon({
          stop: async () => err("test: not running"),
        }),
    });
    const out = captureConsole();
    try {
      const code = await cmds.stop([], false);
      expect(code).toBe(1);
      expect(out.logs[0]).toBe("test daemon is not running");
      expect(out.errors).toHaveLength(0);
    } finally {
      out.restore();
    }
  });

  test("status — running (human)", async () => {
    const cmds = createDaemonCommands({
      name: "test",
      getDaemon: () => mockDaemon(),
    });
    const out = captureConsole();
    try {
      const code = await cmds.status([], false);
      expect(code).toBe(0);
      expect(out.logs[0]).toBe(
        "test is running (PID: 1234, port: 8080, uptime: 2m 0s)",
      );
    } finally {
      out.restore();
    }
  });

  test("status — not running (human)", async () => {
    const cmds = createDaemonCommands({
      name: "test",
      getDaemon: () => mockDaemon({ status: async () => ({ running: false }) }),
    });
    const out = captureConsole();
    try {
      const code = await cmds.status([], false);
      expect(code).toBe(1);
      expect(out.logs[0]).toBe("test is not running");
    } finally {
      out.restore();
    }
  });

  test("status — json output", async () => {
    const cmds = createDaemonCommands({
      name: "test",
      getDaemon: () => mockDaemon(),
    });
    const out = captureConsole();
    try {
      const code = await cmds.status([], true);
      expect(code).toBe(0);
      const parsed = JSON.parse(out.logs[0]);
      expect(parsed.running).toBe(true);
      expect(parsed.pid).toBe(1234);
    } finally {
      out.restore();
    }
  });

  test("restart — success", async () => {
    const cmds = createDaemonCommands({
      name: "test",
      getDaemon: () => mockDaemon(),
    });
    const out = captureConsole();
    try {
      const code = await cmds.restart([], false);
      expect(code).toBe(0);
      expect(out.logs[0]).toBe("test daemon restarted (PID: 5678, port: 8080)");
    } finally {
      out.restore();
    }
  });
});

// --- createHealthCommand ---

describe("createHealthCommand", () => {
  let mockServer: ReturnType<typeof Bun.serve>;
  let healthPort = 0;

  afterAll(() => {
    if (mockServer) mockServer.stop();
  });

  test("healthy response — human output", async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          status: "healthy",
          version: "1.0.0",
          uptime: 3672,
        }),
    });
    healthPort = mockServer.port!;

    const cmd = createHealthCommand({
      name: "test",
      getHealthUrl: () => `http://localhost:${healthPort}/health`,
    });
    const out = captureConsole();
    try {
      const code = await cmd([], false);
      expect(code).toBe(0);
      expect(out.logs).toContain("\nStatus:  healthy");
      expect(out.logs).toContain("Version: 1.0.0");
      expect(out.logs).toContain("Uptime:  1h 1m");
    } finally {
      out.restore();
    }
  });

  test("healthy response — json output", async () => {
    const cmd = createHealthCommand({
      name: "test",
      getHealthUrl: () => `http://localhost:${healthPort}/health`,
    });
    const out = captureConsole();
    try {
      const code = await cmd([], true);
      expect(code).toBe(0);
      const parsed = JSON.parse(out.logs[0]);
      expect(parsed.status).toBe("healthy");
      expect(parsed.version).toBe("1.0.0");
    } finally {
      out.restore();
    }
  });

  test("degraded response — returns 1", async () => {
    mockServer.stop();
    mockServer = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({ status: "degraded", version: "1.0.0", uptime: 10 }),
    });
    healthPort = mockServer.port!;

    const cmd = createHealthCommand({
      name: "test",
      getHealthUrl: () => `http://localhost:${healthPort}/health`,
    });
    const out = captureConsole();
    try {
      const code = await cmd([], false);
      expect(code).toBe(1);
      expect(out.logs).toContain("\nStatus:  degraded");
    } finally {
      out.restore();
    }
  });

  test("unreachable — human error", async () => {
    const cmd = createHealthCommand({
      name: "test",
      getHealthUrl: () => "http://localhost:19999/health",
    });
    const out = captureConsole();
    try {
      const code = await cmd([], false);
      expect(code).toBe(1);
      expect(out.errors[0]).toContain("test is not running on port 19999");
    } finally {
      out.restore();
    }
  });

  test("unreachable — json error", async () => {
    const cmd = createHealthCommand({
      name: "test",
      getHealthUrl: () => "http://localhost:19999/health",
    });
    const out = captureConsole();
    try {
      const code = await cmd([], true);
      expect(code).toBe(1);
      const parsed = JSON.parse(out.logs[0]);
      expect(parsed.error).toBe("Server not reachable");
      expect(parsed.port).toBe("19999");
    } finally {
      out.restore();
    }
  });

  test("formatExtra callback is called", async () => {
    const cmd = createHealthCommand({
      name: "test",
      getHealthUrl: () => `http://localhost:${healthPort}/health`,
      formatExtra: (data) => {
        console.log(`Extra: ${data.status}`);
      },
    });
    const out = captureConsole();
    try {
      await cmd([], false);
      expect(out.logs).toContain("Extra: degraded");
    } finally {
      out.restore();
    }
  });
});
