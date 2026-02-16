/**
 * Shared configuration loading primitives.
 *
 * Provides XDG directory resolution, path expansion, env var interpolation,
 * port validation, and a generic JSON config file loader.
 *
 * All functions that can fail with expected errors return Result<T>.
 * No console output — callers decide what to log.
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Port, Result } from "./result";
import { err, ok } from "./result";

// --- Directory resolution ---

/**
 * Resolve the XDG data directory for a service.
 * Uses `$XDG_DATA_HOME/{name}` if set, otherwise `~/.local/share/{name}`.
 */
export function getDataDir(name: string): string {
  const xdgData = process.env.XDG_DATA_HOME;
  if (xdgData) {
    return join(xdgData, name);
  }
  return join(homedir(), ".local", "share", name);
}

/**
 * Resolve the XDG config directory for a service.
 * Uses `$XDG_CONFIG_HOME/{name}` if set, otherwise `~/.config/{name}`.
 */
export function getConfigDir(name: string): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return join(xdgConfig, name);
  }
  return join(homedir(), ".config", name);
}

// --- Path expansion ---

/**
 * Expand `~` at the start of a path to the user's home directory.
 */
export function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

// --- Env var interpolation ---

/**
 * Replace `${ENV_VAR}` patterns in a string with the corresponding env value.
 * Returns Err if a referenced env var is not set.
 */
export function interpolateEnvVars(value: string): Result<string> {
  let error: string | undefined;

  const result = value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_match, varName: string) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        error = `Config references \${${varName}} but it is not set in the environment`;
        return "";
      }
      return envValue;
    },
  );

  if (error) return err(error);
  return ok(result);
}

/**
 * Recursively walk a JSON-parsed value and interpolate env vars in all strings.
 * Returns Err on the first missing env var.
 */
export function interpolateDeep(value: unknown): Result<unknown> {
  if (typeof value === "string") {
    return interpolateEnvVars(value);
  }
  if (Array.isArray(value)) {
    const results: unknown[] = [];
    for (const item of value) {
      const r = interpolateDeep(item);
      if (!r.ok) return r;
      results.push(r.value);
    }
    return ok(results);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = interpolateDeep(v);
      if (!r.ok) return r;
      result[k] = r.value;
    }
    return ok(result);
  }
  return ok(value);
}

// --- Port validation ---

/**
 * Parse and validate a port number from a string value.
 * Returns a branded Port type on success, Err on invalid input.
 */
export function parsePort(value: string, source: string): Result<Port> {
  const port = Number.parseInt(value, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    return err(
      `${source}: "${value}" is not a valid port number (must be 1-65535)`,
    );
  }
  return ok(port as Port);
}

// --- JSON config loader ---

export interface LoadJsonConfigOpts<T> {
  /** Service name, used for directory resolution. */
  name: string;
  /** Default config object. All fields should have defaults. */
  defaults: T;
  /** Path to the config file. Defaults to `~/.config/{name}/config.json`. */
  configPath?: string;
}

export interface ConfigLoadResult<T> {
  /** The resolved configuration. */
  config: T;
  /** Where the config was loaded from: "file" or "defaults". */
  source: "file" | "defaults";
  /** Path that was checked (whether it existed or not). */
  path: string;
}

/**
 * Load a JSON config file with defaults and `${ENV_VAR}` interpolation.
 *
 * Load order:
 *   1. Start with `defaults`
 *   2. Deep-merge fields from the config file (if it exists)
 *   3. Interpolate `${ENV_VAR}` patterns in all string values
 *
 * Returns Result with config and metadata about the load.
 * Services should apply their own env var overrides and validation
 * on the returned config object.
 */
export function loadJsonConfig<T extends Record<string, unknown>>(
  opts: LoadJsonConfigOpts<T>,
): Result<ConfigLoadResult<T>> {
  const filePath =
    opts.configPath ?? join(getConfigDir(opts.name), "config.json");

  if (!existsSync(filePath)) {
    return ok({
      config: { ...opts.defaults },
      source: "defaults" as const,
      path: filePath,
    });
  }

  let rawText: string;
  try {
    rawText = readFileSync(filePath, "utf-8");
  } catch (e) {
    return err(`Failed to read config file ${filePath}: ${e}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return err(`Failed to parse config file ${filePath}: invalid JSON`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return err(`Config file ${filePath}: must be a JSON object`);
  }

  const interpolated = interpolateDeep(parsed);
  if (!interpolated.ok) return interpolated as Result<never>;

  return ok({
    config: {
      ...opts.defaults,
      ...(interpolated.value as Record<string, unknown>),
    } as T,
    source: "file" as const,
    path: filePath,
  });
}
