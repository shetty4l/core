/**
 * Integration tests for the state persistence system.
 */

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { Field, Persisted } from "../../src/state/decorators";
import { StateLoader } from "../../src/state/loader";
import { sleep } from "./helpers";

describe("integration", () => {
  test("full lifecycle: create → modify → reload → verify", async () => {
    const db = new Database(":memory:");

    @Persisted("lifecycle_state")
    class LifecycleState {
      @Field("string") name: string = "";
      @Field("number") counter: number = 0;
      @Field("boolean") active: boolean = false;
    }

    // Create
    const loader1 = new StateLoader(db);
    const state1 = loader1.load(LifecycleState, "test");
    expect(state1.name).toBe("");
    expect(state1.counter).toBe(0);

    // Modify
    state1.name = "Modified";
    state1.counter = 42;
    state1.active = true;
    await loader1.flush();

    // Reload
    const loader2 = new StateLoader(db);
    const state2 = loader2.load(LifecycleState, "test");

    // Verify
    expect(state2.name).toBe("Modified");
    expect(state2.counter).toBe(42);
    expect(state2.active).toBe(true);

    db.close();
  });

  test("restart simulation: save → close DB → reopen → load", async () => {
    const path = `/tmp/state-test-${Date.now()}.db`;

    @Persisted("restart_state")
    class RestartState {
      @Field("string") value: string = "initial";
    }

    // First "session"
    {
      const db = new Database(path);
      const loader = new StateLoader(db);
      const state = loader.load(RestartState, "key");
      state.value = "persisted";
      await loader.flush();
      db.close();
    }

    // Second "session" - simulating app restart
    {
      const db = new Database(path);
      const loader = new StateLoader(db);
      const state = loader.load(RestartState, "key");
      expect(state.value).toBe("persisted");
      db.close();
    }
  });

  test("multiple state classes in same DB", async () => {
    const db = new Database(":memory:");

    @Persisted("state_a")
    class StateA {
      @Field("string") valueA: string = "";
    }

    @Persisted("state_b")
    class StateB {
      @Field("number") valueB: number = 0;
    }

    const loader = new StateLoader(db);
    const stateA = loader.load(StateA, "keyA");
    const stateB = loader.load(StateB, "keyB");

    stateA.valueA = "from A";
    stateB.valueB = 123;
    await loader.flush();

    // Verify both tables exist with correct data
    const rowA = db
      .prepare("SELECT value_a FROM state_a WHERE key = ?")
      .get("keyA") as { value_a: string } | undefined;
    const rowB = db
      .prepare("SELECT value_b FROM state_b WHERE key = ?")
      .get("keyB") as { value_b: number } | undefined;

    expect(rowA?.value_a).toBe("from A");
    expect(rowB?.value_b).toBe(123);

    db.close();
  });

  test("schema evolution: add field → restart → field preserved", async () => {
    const path = `/tmp/schema-evolution-${Date.now()}.db`;

    // V1: Single field
    {
      @Persisted("evolving_state")
      class EvolvingStateV1 {
        @Field("string") name: string = "original";
      }

      const db = new Database(path);
      const loader = new StateLoader(db);
      const state = loader.load(EvolvingStateV1, "key");
      state.name = "set-in-v1";
      await loader.flush();
      db.close();
    }

    // V2: Added field
    {
      @Persisted("evolving_state")
      class EvolvingStateV2 {
        @Field("string") name: string = "original";
        @Field("number") count: number = 0;
      }

      const db = new Database(path);
      const loader = new StateLoader(db);
      const state = loader.load(EvolvingStateV2, "key");

      // Old field preserved
      expect(state.name).toBe("set-in-v1");
      // New field has default
      expect(state.count).toBe(0);

      db.close();
    }
  });

  test("large number of fields (10+)", async () => {
    const db = new Database(":memory:");

    @Persisted("many_fields_state")
    class ManyFieldsState {
      @Field("string") f1: string = "";
      @Field("string") f2: string = "";
      @Field("string") f3: string = "";
      @Field("string") f4: string = "";
      @Field("string") f5: string = "";
      @Field("number") f6: number = 0;
      @Field("number") f7: number = 0;
      @Field("number") f8: number = 0;
      @Field("boolean") f9: boolean = false;
      @Field("boolean") f10: boolean = false;
      @Field("date") f11: Date | null = null;
      @Field("date") f12: Date | null = null;
    }

    const loader = new StateLoader(db);
    const state = loader.load(ManyFieldsState, "key");

    state.f1 = "a";
    state.f2 = "b";
    state.f6 = 6;
    state.f9 = true;
    state.f11 = new Date("2024-01-01");

    await loader.flush();

    // Reload and verify
    const loader2 = new StateLoader(db);
    const state2 = loader2.load(ManyFieldsState, "key");

    expect(state2.f1).toBe("a");
    expect(state2.f2).toBe("b");
    expect(state2.f6).toBe(6);
    expect(state2.f9).toBe(true);
    expect(state2.f11?.toISOString()).toBe("2024-01-01T00:00:00.000Z");

    db.close();
  });

  test("rapid fire modifications (1000 writes)", async () => {
    const db = new Database(":memory:");

    @Persisted("rapid_state")
    class RapidState {
      @Field("number") counter: number = 0;
    }

    const loader = new StateLoader(db);
    const state = loader.load(RapidState, "key");

    // 1000 rapid writes
    for (let i = 0; i < 1000; i++) {
      state.counter = i;
    }

    await loader.flush();

    // Only final value matters
    const row = db
      .prepare("SELECT counter FROM rapid_state WHERE key = ?")
      .get("key") as { counter: number };
    expect(row.counter).toBe(999);

    db.close();
  });

  test("flush during active debounce", async () => {
    const db = new Database(":memory:");

    @Persisted("debounce_flush_state")
    class DebounceFlushState {
      @Field("string") value: string = "";
    }

    const loader = new StateLoader(db);
    const state = loader.load(DebounceFlushState, "key");

    state.value = "first";
    await sleep(30); // Partway through debounce

    state.value = "second";
    await loader.flush(); // Should save immediately

    const row = db
      .prepare("SELECT value FROM debounce_flush_state WHERE key = ?")
      .get("key") as { value: string };
    expect(row.value).toBe("second");

    db.close();
  });
});
