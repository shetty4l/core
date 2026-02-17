/**
 * CLI argument parsing and command dispatch scaffold.
 *
 * Zero-dependency CLI primitives shared across all services.
 * Each service defines its own commands and help text.
 */

// --- Arg parsing ---

export interface ParsedArgs {
  command: string;
  args: string[];
  json: boolean;
}

/**
 * Parse CLI arguments into a command name, positional args, and the --json flag.
 * Strips `--json` from the args array before extracting the command.
 */
export function parseArgs(args: string[]): ParsedArgs {
  const filtered = args.filter((a) => a !== "--json");
  const json = args.includes("--json");
  const [command = "help", ...rest] = filtered;
  return { command, args: rest, json };
}

// --- Uptime formatting ---

/**
 * Format a duration in seconds into a human-readable string.
 * Examples: "45s", "3m 12s", "2h 15m"
 */
export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

// --- Log file tail ---

export interface LogsCommandOpts {
  /** Absolute path to the log file. */
  logFile: string;
  /** Default number of lines when no count is specified. */
  defaultCount?: number;
  /** Message to display when the log file does not exist or is empty. */
  emptyMessage?: string;
}

/**
 * Create a `logs` command handler that tails a log file.
 *
 * Supports a positional count argument (`logs 50`) and the standard `--json` flag.
 * Returns exit code 0 on success, 1 on error.
 */
export function createLogsCommand(opts: LogsCommandOpts): CommandHandler {
  const {
    logFile,
    defaultCount = 20,
    emptyMessage = "No log entries yet.",
  } = opts;

  return async (args: string[], json: boolean): Promise<number> => {
    const count = args.length > 0 ? Number.parseInt(args[0], 10) : defaultCount;
    if (Number.isNaN(count) || count <= 0) {
      console.error(`Invalid count: ${args[0]}`);
      return 1;
    }

    const file = Bun.file(logFile);
    if (!(await file.exists())) {
      if (json) {
        console.log(JSON.stringify({ lines: [], file: logFile }));
      } else {
        console.log(emptyMessage);
      }
      return 0;
    }

    const text = await file.text();
    const allLines = text.split("\n").filter((l) => l.length > 0);

    if (allLines.length === 0) {
      if (json) {
        console.log(JSON.stringify({ lines: [], file: logFile }));
      } else {
        console.log(emptyMessage);
      }
      return 0;
    }

    const lines = allLines.slice(-count);

    if (json) {
      console.log(
        JSON.stringify({ lines, file: logFile, total: allLines.length }),
      );
    } else {
      for (const line of lines) {
        console.log(line);
      }
    }
    return 0;
  };
}

// --- Command dispatch ---

export type CommandHandler = (
  args: string[],
  json: boolean,
) => void | number | Promise<void | number>;

export interface RunCliOpts {
  /** Service name, used in error messages. */
  name: string;
  /** Current version string. */
  version: string;
  /** Map of command name -> handler function. */
  commands: Record<string, CommandHandler>;
  /** Help text to display for --help and the `help` command. */
  help: string;
}

/**
 * Run the CLI: parse process.argv, dispatch to the matching command handler.
 *
 * Handles --help/-h, --version/-v, and unknown commands automatically.
 * If the handler returns a number, exits with that code.
 * If the handler returns void, the process stays alive (for long-running servers).
 */
export async function runCli(opts: RunCliOpts): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (
    rawArgs.includes("--help") ||
    rawArgs.includes("-h") ||
    rawArgs.length === 0
  ) {
    console.log(opts.help);
    process.exit(0);
  }

  if (rawArgs.includes("--version") || rawArgs.includes("-v")) {
    console.log(opts.version);
    process.exit(0);
  }

  const { command, args, json } = parseArgs(rawArgs);

  if (command === "help") {
    console.log(opts.help);
    process.exit(0);
  }

  if (command === "version") {
    if (json) {
      console.log(JSON.stringify({ version: opts.version }));
    } else {
      console.log(opts.version);
    }
    process.exit(0);
  }

  const handler = opts.commands[command];
  if (!handler) {
    console.error(`${opts.name}: unknown command "${command}"`);
    console.error(`Run "${opts.name} --help" for usage.`);
    process.exit(1);
  }

  const result = await handler(args, json);

  // If the handler returned a number, exit with that code.
  // If it returned void/undefined, the command is long-running (e.g. serve)
  // and the process should stay alive.
  if (typeof result === "number") {
    process.exit(result);
  }
}
