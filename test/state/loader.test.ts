/**
 * Tests for StateLoader.
 */

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Field, Persisted } from "../../src/state/decorators";
import { StateLoader } from "../../src/state/loader";
import { createTestDb, getRow, sleep } from "./helpers";

let db: Database;
let loader: StateLoader;

beforeEach(() => {
  db = createTestDb();
  loader = new StateLoader(db);
});

afterEach(async () => {
  await loader.flush();
  db.close();
});

// Test classes defined outside describe blocks for metadata stability
@Persisted("basic_state")
class BasicState {
  @Field("string") name: string = "default";
  @Field("number") count: number = 0;
}

@Persisted("all_types_state")
class AllTypesState {
  @Field("string") str: string = "";
  @Field("number") num: number = 0;
  @Field("boolean") bool: boolean = false;
  @Field("date") dt: Date | null = null;
}

@Persisted("multi_key_state")
class MultiKeyState {
  @Field("string") value: string = "";
}

class UndecoratedState {
  value = 42;
}

describe("StateLoader.load", () => {
  test("creates new row with default values", () => {
    const state = loader.load(BasicState, "new-key");

    expect(state.name).toBe("default");
    expect(state.count).toBe(0);

    // Verify in database
    const row = getRow(db, "basic_state", "new-key");
    expect(row).toBeDefined();
    expect(row!.name).toBe("default");
  });

  test("reads existing row", async () => {
    // Create initial state
    const state1 = loader.load(BasicState, "existing-key");
    state1.name = "modified";
    state1.count = 42;
    await loader.flush();

    // Create new loader and load same key
    const loader2 = new StateLoader(db);
    const state2 = loader2.load(BasicState, "existing-key");

    expect(state2.name).toBe("modified");
    expect(state2.count).toBe(42);
  });

  test("deserializes all field types correctly", async () => {
    const state1 = loader.load(AllTypesState, "types-key");
    const testDate = new Date("2024-06-15T12:00:00.000Z");

    state1.str = "hello";
    state1.num = 3.14;
    state1.bool = true;
    state1.dt = testDate;
    await loader.flush();

    const loader2 = new StateLoader(db);
    const state2 = loader2.load(AllTypesState, "types-key");

    expect(state2.str).toBe("hello");
    expect(state2.num).toBe(3.14);
    expect(state2.bool).toBe(true);
    expect(state2.dt).toBeInstanceOf(Date);
    expect(state2.dt!.getTime()).toBe(testDate.getTime());
  });

  test("throws on undecorated class", () => {
    expect(() => {
      loader.load(UndecoratedState, "key");
    }).toThrow(/not decorated with @Persisted/);
  });

  test("undecorated error includes class name", () => {
    try {
      loader.load(UndecoratedState, "key");
      expect(true).toBe(false);
    } catch (e) {
      expect((e as Error).message).toContain("UndecoratedState");
    }
  });

  test("different keys load different rows", async () => {
    const state1 = loader.load(MultiKeyState, "key1");
    const state2 = loader.load(MultiKeyState, "key2");

    state1.value = "first";
    state2.value = "second";
    await loader.flush();

    const row1 = getRow(db, "multi_key_state", "key1");
    const row2 = getRow(db, "multi_key_state", "key2");

    expect(row1!.value).toBe("first");
    expect(row2!.value).toBe("second");
  });

  test("same key loads same row (identity)", async () => {
    const state1 = loader.load(BasicState, "same-key");
    state1.name = "updated";
    await loader.flush();

    const state2 = loader.load(BasicState, "same-key");
    expect(state2.name).toBe("updated");
  });
});

describe("auto-save behavior", () => {
  test("property set triggers save", async () => {
    const state = loader.load(BasicState, "save-key");
    state.name = "changed";

    // Wait for debounce
    await sleep(150);

    const row = getRow(db, "basic_state", "save-key");
    expect(row!.name).toBe("changed");
  });

  test("single write saves after debounce delay", async () => {
    const state = loader.load(BasicState, "debounce-key");
    state.count = 100;

    // Before debounce
    await sleep(50);
    const row1 = getRow(db, "basic_state", "debounce-key");
    expect(row1!.count).toBe(0); // Still default

    // After debounce
    await sleep(100);
    const row2 = getRow(db, "basic_state", "debounce-key");
    expect(row2!.count).toBe(100);
  });

  test("rapid writes coalesce to single save", async () => {
    const state = loader.load(BasicState, "coalesce-key");

    // Rapid writes
    for (let i = 0; i < 10; i++) {
      state.count = i;
    }

    // Wait for debounce
    await sleep(150);

    // Only final value should be saved
    const row = getRow(db, "basic_state", "coalesce-key");
    expect(row!.count).toBe(9);
  });

  test("different properties coalesce", async () => {
    const state = loader.load(BasicState, "prop-coalesce-key");

    state.name = "a";
    state.count = 1;
    state.name = "b";
    state.count = 2;

    await sleep(150);

    const row = getRow(db, "basic_state", "prop-coalesce-key");
    expect(row!.name).toBe("b");
    expect(row!.count).toBe(2);
  });

  test("debounce timer resets on each write", async () => {
    const state = loader.load(BasicState, "reset-key");

    state.count = 1;
    await sleep(50);
    state.count = 2; // Reset timer
    await sleep(50);
    state.count = 3; // Reset timer again

    // 50ms after last write, should not have saved yet
    const row1 = getRow(db, "basic_state", "reset-key");
    expect(row1!.count).toBe(0);

    // After full debounce from last write
    await sleep(100);
    const row2 = getRow(db, "basic_state", "reset-key");
    expect(row2!.count).toBe(3);
  });
});

describe("flush", () => {
  test("saves pending changes immediately", async () => {
    const state = loader.load(BasicState, "flush-key");
    state.name = "flushed";

    // Don't wait for debounce
    await loader.flush();

    const row = getRow(db, "basic_state", "flush-key");
    expect(row!.name).toBe("flushed");
  });

  test("with no pending changes is no-op", async () => {
    loader.load(BasicState, "noop-key");
    // No changes made

    await loader.flush(); // Should not throw
  });

  test("cancels pending debounce timer", async () => {
    const state = loader.load(BasicState, "cancel-key");
    state.count = 50;

    await loader.flush(); // Save immediately

    // Change again
    state.count = 100;
    await loader.flush();

    // Final state
    const row = getRow(db, "basic_state", "cancel-key");
    expect(row!.count).toBe(100);
  });

  test("returns awaitable Promise", async () => {
    const state = loader.load(BasicState, "promise-key");
    state.name = "async";

    const result = loader.flush();
    expect(result).toBeInstanceOf(Promise);
    await result;

    const row = getRow(db, "basic_state", "promise-key");
    expect(row!.name).toBe("async");
  });
});

describe("proxy behavior", () => {
  test("reading properties returns current value", () => {
    const state = loader.load(BasicState, "read-key");
    state.name = "test";
    expect(state.name).toBe("test");
  });

  test("Object.keys() works", () => {
    const state = loader.load(BasicState, "keys-key");
    const keys = Object.keys(state);
    expect(keys).toContain("name");
    expect(keys).toContain("count");
  });

  test("JSON.stringify() works", () => {
    const state = loader.load(BasicState, "json-key");
    state.name = "json-test";
    state.count = 42;

    const json = JSON.stringify(state);
    const parsed = JSON.parse(json);

    expect(parsed.name).toBe("json-test");
    expect(parsed.count).toBe(42);
  });
});
