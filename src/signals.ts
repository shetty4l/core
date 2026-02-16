/**
 * Graceful shutdown signal handling.
 *
 * Registers SIGINT/SIGTERM handlers that call a cleanup function
 * before exiting. Supports timeout-based forced exit and
 * double-signal emergency exit.
 */

export interface ShutdownOpts {
  /** Signals to handle. Defaults to ["SIGINT", "SIGTERM"]. */
  signals?: string[];
  /** Force exit after this many ms. No timeout if omitted. */
  timeoutMs?: number;
}

/**
 * Register graceful shutdown handlers.
 *
 * On first signal: calls `cleanup()`, then `process.exit(0)`.
 * On second signal (while cleanup is running): forces `process.exit(1)`.
 * If `timeoutMs` is set: forces `process.exit(1)` after timeout.
 */
export function onShutdown(
  cleanup: () => void | Promise<void>,
  opts?: ShutdownOpts,
): void {
  const signals = opts?.signals ?? ["SIGINT", "SIGTERM"];
  const timeoutMs = opts?.timeoutMs;
  let shutting = false;

  const handler = (signal: string) => {
    if (shutting) {
      process.exit(1);
    }
    shutting = true;
    console.log(`\n${signal} received, shutting down...`);

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        console.error(`Shutdown timed out after ${timeoutMs}ms, forcing exit`);
        process.exit(1);
      }, timeoutMs);
      // Don't block the event loop from exiting
      timer.unref();
    }

    const maybePromise = cleanup();
    if (maybePromise && typeof maybePromise.then === "function") {
      maybePromise
        .then(() => {
          if (timer) clearTimeout(timer);
          process.exit(0);
        })
        .catch((err) => {
          console.error("Shutdown cleanup error:", err);
          if (timer) clearTimeout(timer);
          process.exit(1);
        });
    } else {
      if (timer) clearTimeout(timer);
      process.exit(0);
    }
  };

  for (const signal of signals) {
    process.on(signal, () => handler(signal));
  }
}
