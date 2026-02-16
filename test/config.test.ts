import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  expandPath,
  getConfigDir,
  getDataDir,
  interpolateDeep,
  interpolateEnvVars,
  loadJsonConfig,
  parsePort,
} from "../src/config";

const TMP = join(import.meta.dir, ".tmp-config");

beforeEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  // Clean up env vars
  delete process.env.XDG_DATA_HOME;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CORE_TEST_VAR;
});

// --- getDataDir ---

describe("getDataDir", () => {
  test("uses XDG_DATA_HOME when set", () => {
    process.env.XDG_DATA_HOME = "/custom/data";
    expect(getDataDir("engram")).toBe("/custom/data/engram");
  });

  test("falls back to ~/.local/share/{name}", () => {
    delete process.env.XDG_DATA_HOME;
    expect(getDataDir("engram")).toBe(
      join(homedir(), ".local", "share", "engram"),
    );
  });
});

// --- getConfigDir ---

describe("getConfigDir", () => {
  test("uses XDG_CONFIG_HOME when set", () => {
    process.env.XDG_CONFIG_HOME = "/custom/config";
    expect(getConfigDir("synapse")).toBe("/custom/config/synapse");
  });

  test("falls back to ~/.config/{name}", () => {
    delete process.env.XDG_CONFIG_HOME;
    expect(getConfigDir("synapse")).toBe(join(homedir(), ".config", "synapse"));
  });
});

// --- expandPath ---

describe("expandPath", () => {
  test("expands ~ to homedir", () => {
    const result = expandPath("~/foo/bar");
    expect(result).toBe(join(homedir(), "foo/bar"));
  });

  test("leaves absolute paths unchanged", () => {
    expect(expandPath("/usr/bin")).toBe("/usr/bin");
  });

  test("leaves relative paths unchanged", () => {
    expect(expandPath("foo/bar")).toBe("foo/bar");
  });
});

// --- interpolateEnvVars ---

describe("interpolateEnvVars", () => {
  test("replaces env var references", () => {
    process.env.CORE_TEST_VAR = "hello";
    const result = interpolateEnvVars("prefix-${CORE_TEST_VAR}-suffix");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("prefix-hello-suffix");
  });

  test("returns err for missing env var", () => {
    delete process.env.CORE_TEST_VAR;
    const result = interpolateEnvVars("${CORE_TEST_VAR}");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("CORE_TEST_VAR");
  });

  test("returns string unchanged when no vars present", () => {
    const result = interpolateEnvVars("plain string");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("plain string");
  });
});

// --- interpolateDeep ---

describe("interpolateDeep", () => {
  test("interpolates strings in nested objects", () => {
    process.env.CORE_TEST_VAR = "world";
    const result = interpolateDeep({
      greeting: "hello ${CORE_TEST_VAR}",
      nested: { value: "${CORE_TEST_VAR}" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        greeting: "hello world",
        nested: { value: "world" },
      });
    }
  });

  test("interpolates strings in arrays", () => {
    process.env.CORE_TEST_VAR = "item";
    const result = interpolateDeep(["${CORE_TEST_VAR}", 42, true]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["item", 42, true]);
    }
  });

  test("passes through non-string primitives", () => {
    const result = interpolateDeep({ num: 42, bool: true, nil: null });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ num: 42, bool: true, nil: null });
    }
  });

  test("returns err on missing env var in nested value", () => {
    delete process.env.CORE_TEST_VAR;
    const result = interpolateDeep({ deep: { value: "${CORE_TEST_VAR}" } });
    expect(result.ok).toBe(false);
  });
});

// --- parsePort ---

describe("parsePort", () => {
  test("valid port returns Ok with branded Port", () => {
    const result = parsePort("8080", "TEST");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value as number).toBe(8080);
  });

  test("port 1 is valid", () => {
    const result = parsePort("1", "TEST");
    expect(result.ok).toBe(true);
  });

  test("port 65535 is valid", () => {
    const result = parsePort("65535", "TEST");
    expect(result.ok).toBe(true);
  });

  test("port 0 is invalid", () => {
    const result = parsePort("0", "TEST");
    expect(result.ok).toBe(false);
  });

  test("port 65536 is invalid", () => {
    const result = parsePort("65536", "TEST");
    expect(result.ok).toBe(false);
  });

  test("non-numeric returns error", () => {
    const result = parsePort("abc", "SOURCE");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("abc");
      expect(result.error).toContain("SOURCE");
    }
  });
});

// --- loadJsonConfig ---

describe("loadJsonConfig", () => {
  const defaults = { host: "localhost", port: 3000 };

  test("returns defaults when config file missing", () => {
    const result = loadJsonConfig({
      name: "test",
      defaults,
      configPath: join(TMP, "nonexistent.json"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.config).toEqual(defaults);
      expect(result.value.source).toBe("defaults");
    }
  });

  test("merges file config with defaults", () => {
    const configPath = join(TMP, "config.json");
    writeFileSync(configPath, JSON.stringify({ port: 9999 }));

    const result = loadJsonConfig({ name: "test", defaults, configPath });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.config).toEqual({ host: "localhost", port: 9999 });
      expect(result.value.source).toBe("file");
    }
  });

  test("interpolates env vars in config file", () => {
    process.env.CORE_TEST_VAR = "from-env";
    const configPath = join(TMP, "config.json");
    writeFileSync(configPath, JSON.stringify({ host: "${CORE_TEST_VAR}" }));

    const result = loadJsonConfig({ name: "test", defaults, configPath });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.config.host).toBe("from-env");
    }
  });

  test("returns err for invalid JSON", () => {
    const configPath = join(TMP, "config.json");
    writeFileSync(configPath, "not json{{{");

    const result = loadJsonConfig({ name: "test", defaults, configPath });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("invalid JSON");
  });

  test("returns err for non-object JSON", () => {
    const configPath = join(TMP, "config.json");
    writeFileSync(configPath, "[1, 2, 3]");

    const result = loadJsonConfig({ name: "test", defaults, configPath });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("must be a JSON object");
  });

  test("returns err for missing env var in config", () => {
    delete process.env.CORE_TEST_VAR;
    const configPath = join(TMP, "config.json");
    writeFileSync(configPath, JSON.stringify({ host: "${CORE_TEST_VAR}" }));

    const result = loadJsonConfig({ name: "test", defaults, configPath });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("CORE_TEST_VAR");
  });
});
