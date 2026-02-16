/**
 * Daemon process management.
 *
 * Manages background service processes via PID files.
 * Parameterized by service name so each service can reuse the same logic.
 *
 * No console output — returns structured results for the caller to log.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import type { Result } from "./result";
import { err, ok } from "./result";

// --- Types ---

export interface DaemonManagerOpts {
  /** Service name (e.g. "engram"). Used in status messages. */
  name: string;
  /** Directory for PID and log files (e.g. ~/.config/engram). */
  configDir: string;
  /** Absolute path to the CLI entry point (e.g. /path/to/src/cli.ts). */
  cliPath: string;
  /** CLI command to run in foreground mode. Defaults to "serve". */
  serveCommand?: string;
  /** Health endpoint URL for verifying the daemon is responsive. */
  healthUrl?: string;
  /** Milliseconds to wait after spawn before health-checking. Defaults to 500. */
  startupWaitMs?: number;
  /** Milliseconds to wait for graceful stop before SIGKILL. Defaults to 5000. */
  stopTimeoutMs?: number;
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  port?: number;
  uptime?: number;
}

export interface DaemonManager {
  start(): Promise<Result<DaemonStatus>>;
  stop(): Promise<Result<DaemonStatus>>;
  restart(): Promise<Result<DaemonStatus>>;
  status(): Promise<DaemonStatus>;
}

// --- Internal helpers ---

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(pidFile: string): number | undefined {
  if (!existsSync(pidFile)) return undefined;
  try {
    const content = readFileSync(pidFile, "utf-8").trim();
    const pid = Number.parseInt(content, 10);
    return Number.isNaN(pid) ? undefined : pid;
  } catch {
    return undefined;
  }
}

function writePid(pidFile: string, pid: number): void {
  Bun.write(pidFile, String(pid));
}

function removePidFile(pidFile: string): void {
  try {
    unlinkSync(pidFile);
  } catch {
    // Already gone
  }
}

// --- Factory ---

/**
 * Create a daemon manager for a service.
 *
 * The daemon is a `bun run <cliPath> serve` background process.
 * State is tracked via a PID file in `configDir`.
 */
export function createDaemonManager(opts: DaemonManagerOpts): DaemonManager {
  const {
    name,
    configDir,
    cliPath,
    serveCommand = "serve",
    healthUrl,
    startupWaitMs = 500,
    stopTimeoutMs = 5000,
  } = opts;

  const pidFile = join(configDir, `${name}.pid`);
  const logFile = join(configDir, `${name}.log`);

  async function checkHealth(): Promise<{
    healthy: boolean;
    uptime?: number;
    port?: number;
  }> {
    if (!healthUrl) return { healthy: false };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(healthUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return { healthy: false };
      const data = (await res.json()) as {
        uptime?: number;
        port?: number;
      };
      return { healthy: true, uptime: data.uptime, port: data.port };
    } catch {
      return { healthy: false };
    }
  }

  const manager: DaemonManager = {
    async status(): Promise<DaemonStatus> {
      const pid = readPid(pidFile);
      if (!pid || !isProcessRunning(pid)) {
        if (pid) removePidFile(pidFile);
        return { running: false };
      }

      const health = await checkHealth();
      return {
        running: true,
        pid,
        uptime: health.uptime,
        port: health.port,
      };
    },

    async start(): Promise<Result<DaemonStatus>> {
      const current = await manager.status();
      if (current.running) {
        return err(`${name}: already running (PID ${current.pid})`);
      }

      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      const proc = Bun.spawn(["bun", "run", cliPath, serveCommand], {
        stdout: Bun.file(logFile),
        stderr: Bun.file(logFile),
        stdin: "ignore",
      });

      writePid(pidFile, proc.pid);
      await new Promise((resolve) => setTimeout(resolve, startupWaitMs));

      const status = await manager.status();
      if (status.running) {
        return ok(status);
      }

      removePidFile(pidFile);
      return err(`${name}: failed to start (check ${logFile})`);
    },

    async stop(): Promise<Result<DaemonStatus>> {
      const current = await manager.status();
      if (!current.running || !current.pid) {
        removePidFile(pidFile);
        return err(`${name}: not running`);
      }

      process.kill(current.pid, "SIGTERM");

      const interval = 100;
      let waited = 0;
      while (waited < stopTimeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, interval));
        waited += interval;
        if (!isProcessRunning(current.pid)) break;
      }

      if (isProcessRunning(current.pid)) {
        process.kill(current.pid, "SIGKILL");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      removePidFile(pidFile);
      return ok({ running: false, pid: current.pid });
    },

    async restart(): Promise<Result<DaemonStatus>> {
      await manager.stop();
      return manager.start();
    },
  };

  return manager;
}
