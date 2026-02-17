import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createLogsCommand, formatUptime, parseArgs } from "../src/cli";

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
