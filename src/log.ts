/**
 * Lightweight structured logger for all services.
 *
 * Each service creates a named logger via `createLogger("serviceName")`.
 * Output format: `[ISO timestamp] name: message`
 * All output goes to stderr via console.error so stdout stays clean for
 * structured CLI output (--json).
 */

export type Logger = (msg: string) => void;

/**
 * Create a prefixed logger that writes to stderr.
 *
 * @param name - Service or module name (e.g. "cortex", "synapse")
 * @returns A function that logs `[timestamp] name: msg` to stderr
 *
 * @example
 * ```ts
 * const log = createLogger("cortex");
 * log("processing loop started");
 * // => [2026-02-20T11:36:00.000Z] cortex: processing loop started
 * ```
 */
export function createLogger(name: string): Logger {
  return (msg: string) => {
    console.error(`[${new Date().toISOString()}] ${name}: ${msg}`);
  };
}
