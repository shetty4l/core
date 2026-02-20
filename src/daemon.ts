/**
 * Daemon process management.
 *
 * Manages background service processes via PID files.
 * Parameterized by service name so each service can reuse the same logic.
 *
 * No console output — returns structured results for the caller to log.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "fs";
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
  /** Milliseconds between health poll attempts during startup. Defaults to 500. */
  startupPollMs?: number;
  /** Total milliseconds to wait for health endpoint after spawn. Defaults to 10000. */
  healthTimeoutMs?: number;
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
    startupPollMs = 500,
    healthTimeoutMs = 10_000,
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

      // Rotate previous log file so it doesn't grow unbounded.
      // Keep one generation: service.log -> service.log.old
      if (existsSync(logFile)) {
        try {
          renameSync(logFile, `${logFile}.old`);
        } catch {
          // Best-effort — if rotation fails, append to existing file
        }
      }

      // Open log file in append mode so ongoing console.error output
      // from the child is captured.
      // Bun.file() opens with O_WRONLY|O_CREAT (no append, no truncate)
      // which writes from offset 0 and corrupts logs — always use openSync("a").
      const logFd = openSync(logFile, "a");

      const proc = Bun.spawn(["bun", "run", cliPath, serveCommand], {
        stdout: logFd,
        stderr: logFd,
        stdin: "ignore",
      });

      // Child inherits its own copy of the fd; parent can close safely.
      closeSync(logFd);

      writePid(pidFile, proc.pid);

      if (healthUrl) {
        // Poll health endpoint until responsive or timeout
        let waited = 0;
        while (waited < healthTimeoutMs) {
          await new Promise((resolve) => setTimeout(resolve, startupPollMs));
          waited += startupPollMs;

          if (!isProcessRunning(proc.pid)) {
            removePidFile(pidFile);
            return err(
              `${name}: process exited during startup (check ${logFile})`,
            );
          }

          const health = await checkHealth();
          if (health.healthy) {
            return ok({
              running: true,
              pid: proc.pid,
              uptime: health.uptime,
              port: health.port,
            });
          }
        }

        // Timed out — kill the unresponsive process
        process.kill(proc.pid, "SIGKILL");
        await new Promise((resolve) => setTimeout(resolve, 100));
        removePidFile(pidFile);
        return err(
          `${name}: health check timed out after ${healthTimeoutMs}ms (check ${logFile})`,
        );
      }

      // No health URL — fall back to PID check after one poll interval
      await new Promise((resolve) => setTimeout(resolve, startupPollMs));
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
      const stopResult = await manager.stop();
      // Propagate stop errors unless the service simply wasn't running
      if (!stopResult.ok && !stopResult.error.includes("not running")) {
        return stopResult;
      }
      // Brief delay to let the OS release the port
      await new Promise((resolve) => setTimeout(resolve, startupPollMs));
      return manager.start();
    },
  };

  return manager;
}
