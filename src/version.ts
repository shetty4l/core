/**
 * Read the VERSION file from a project root directory.
 * Falls back to a default version string if the file doesn't exist.
 *
 * The VERSION file is written by CI during the release workflow.
 * In local development, the fallback is used.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Read a VERSION file from the given directory (project root).
 *
 * @param rootDir - Absolute path to the project root (where VERSION lives).
 * @param fallback - Version string to use when VERSION file doesn't exist. Defaults to "0.0.0-dev".
 */
export function readVersion(
  rootDir: string,
  fallback: string = "0.0.0-dev",
): string {
  const versionFile = join(rootDir, "VERSION");
  if (existsSync(versionFile)) {
    return readFileSync(versionFile, "utf-8").trim();
  }
  return fallback;
}
