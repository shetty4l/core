/**
 * @shetty4l/core
 *
 * Shared infrastructure primitives for Bun/TypeScript services.
 *
 * Import from the root for convenience, or from sub-paths for specificity:
 *   import { config, http, log } from "@shetty4l/core"
 *   import { parsePort } from "@shetty4l/core/config"
 */

export * as cli from "./cli";
// Domain modules — exported as namespaces
export * as config from "./config";
export * as daemon from "./daemon";
export * as db from "./db";
export * as http from "./http";
export * as log from "./log";
export type { Err, Ok, Port, Result } from "./result";
export { err, ok } from "./result";
export type { ShutdownOpts } from "./signals";
export { onShutdown } from "./signals";
// Universal primitives — exported directly
export { readVersion } from "./version";
