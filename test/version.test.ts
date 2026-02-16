import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { readVersion } from "../src/version";

const TMP = join(import.meta.dir, ".tmp-version");

function setup() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(TMP, { recursive: true });
}

function teardown() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
}

describe("readVersion", () => {
  test("returns fallback when VERSION file missing", () => {
    setup();
    try {
      expect(readVersion(TMP)).toBe("0.0.0-dev");
    } finally {
      teardown();
    }
  });

  test("returns custom fallback when VERSION file missing", () => {
    setup();
    try {
      expect(readVersion(TMP, "1.0.0-local")).toBe("1.0.0-local");
    } finally {
      teardown();
    }
  });

  test("reads VERSION file when present", () => {
    setup();
    try {
      writeFileSync(join(TMP, "VERSION"), "2.3.4\n");
      expect(readVersion(TMP)).toBe("2.3.4");
    } finally {
      teardown();
    }
  });

  test("trims whitespace from VERSION file", () => {
    setup();
    try {
      writeFileSync(join(TMP, "VERSION"), "  1.0.0  \n\n");
      expect(readVersion(TMP)).toBe("1.0.0");
    } finally {
      teardown();
    }
  });
});
