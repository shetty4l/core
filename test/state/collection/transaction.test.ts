/**
 * Tests for StateLoader transaction support: transaction(), modify().
 */

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  Field,
  Id,
  PersistedCollection,
} from "../../../src/state/collection/decorators";
import { CollectionEntity } from "../../../src/state/collection/types";
import { StateLoader } from "../../../src/state/loader";
import { createTestDb } from "../helpers";

let db: Database;
let loader: StateLoader;

beforeEach(() => {
  db = createTestDb();
  loader = new StateLoader(db);
});

afterEach(() => {
  db.close();
});

@PersistedCollection("tx_accounts")
class TxAccount extends CollectionEntity {
  @Id() id: string = "";
  @Field("string") name: string = "";
  @Field("number") balance: number = 0;

  async save(): Promise<void> {
    throw new Error("Not bound");
  }
  async delete(): Promise<void> {
    throw new Error("Not bound");
  }
}

// --------------------------------------------------------------------------
// transaction() tests
// --------------------------------------------------------------------------

describe("StateLoader.transaction", () => {
  test("commits on success", async () => {
    await loader.transaction(async () => {
      loader.create(TxAccount, { id: "a1", name: "Alice", balance: 100 });
      loader.create(TxAccount, { id: "a2", name: "Bob", balance: 200 });
    });

    expect(loader.count(TxAccount)).toBe(2);
  });

  test("rolls back on error", async () => {
    try {
      await loader.transaction(async () => {
        loader.create(TxAccount, { id: "a1", name: "Alice", balance: 100 });
        throw new Error("Simulated failure");
      });
    } catch {
      // Expected
    }

    expect(loader.count(TxAccount)).toBe(0);
  });

  test("re-throws the original error", async () => {
    const originalError = new Error("Custom error message");

    try {
      await loader.transaction(async () => {
        throw originalError;
      });
      expect(true).toBe(false); // Should not reach here
    } catch (e) {
      expect(e).toBe(originalError);
    }
  });

  test("returns the function result on success", async () => {
    const result = await loader.transaction(async () => {
      loader.create(TxAccount, { id: "a1", balance: 100 });
      return 42;
    });

    expect(result).toBe(42);
  });

  test("supports sync functions", async () => {
    const result = await loader.transaction(() => {
      loader.create(TxAccount, { id: "a1", balance: 100 });
      return "sync result";
    });

    expect(result).toBe("sync result");
    expect(loader.count(TxAccount)).toBe(1);
  });

  test("multiple operations atomically", async () => {
    loader.create(TxAccount, { id: "a1", name: "Alice", balance: 100 });
    loader.create(TxAccount, { id: "a2", name: "Bob", balance: 100 });

    // Transfer should succeed atomically
    await loader.transaction(async () => {
      loader.updateWhere(TxAccount, { id: "a1" }, { balance: 50 });
      loader.updateWhere(TxAccount, { id: "a2" }, { balance: 150 });
    });

    const alice = loader.get(TxAccount, "a1")!;
    const bob = loader.get(TxAccount, "a2")!;

    expect(alice.balance).toBe(50);
    expect(bob.balance).toBe(150);
  });

  test("partial failure rolls back all changes", async () => {
    loader.create(TxAccount, { id: "a1", name: "Alice", balance: 100 });
    loader.create(TxAccount, { id: "a2", name: "Bob", balance: 100 });

    try {
      await loader.transaction(async () => {
        loader.updateWhere(TxAccount, { id: "a1" }, { balance: 50 });
        throw new Error("Transfer failed");
        // Second update never happens
      });
    } catch {
      // Expected
    }

    // First update should be rolled back
    const alice = loader.get(TxAccount, "a1")!;
    expect(alice.balance).toBe(100);
  });
});

// --------------------------------------------------------------------------
// modify() tests
// --------------------------------------------------------------------------

describe("StateLoader.modify", () => {
  test("modifies existing entity", async () => {
    loader.create(TxAccount, { id: "a1", name: "Alice", balance: 100 });

    const account = await loader.modify(TxAccount, "a1", (a) => {
      a.balance += 50;
    });

    expect(account.balance).toBe(150);

    // Verify persisted
    const row = db
      .prepare("SELECT balance FROM tx_accounts WHERE id = ?")
      .get("a1") as {
      balance: number;
    };
    expect(row.balance).toBe(150);
  });

  test("returns the modified entity", async () => {
    loader.create(TxAccount, { id: "a1", name: "Alice", balance: 100 });

    const account = await loader.modify(TxAccount, "a1", (a) => {
      a.name = "Alicia";
    });

    expect(account.name).toBe("Alicia");
  });

  test("throws when entity not found", async () => {
    await expect(
      loader.modify(TxAccount, "nonexistent", (a) => {
        a.balance = 0;
      }),
    ).rejects.toThrow(/not found/);
  });

  test("error message includes class name and id", async () => {
    try {
      await loader.modify(TxAccount, "missing-id", () => {});
      expect(true).toBe(false);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("TxAccount");
      expect(msg).toContain("missing-id");
    }
  });

  test("auto-saves after modification", async () => {
    loader.create(TxAccount, { id: "a1", balance: 100 });

    await loader.modify(TxAccount, "a1", (a) => {
      a.balance = 200;
    });

    // Should be persisted without explicit save
    const fresh = loader.get(TxAccount, "a1")!;
    expect(fresh.balance).toBe(200);
  });

  test("multiple modifications in sequence", async () => {
    loader.create(TxAccount, { id: "a1", balance: 100 });

    await loader.modify(TxAccount, "a1", (a) => {
      a.balance += 10;
    });
    await loader.modify(TxAccount, "a1", (a) => {
      a.balance += 20;
    });
    await loader.modify(TxAccount, "a1", (a) => {
      a.balance += 30;
    });

    const account = loader.get(TxAccount, "a1")!;
    expect(account.balance).toBe(160); // 100 + 10 + 20 + 30
  });

  test("works with number id", async () => {
    @PersistedCollection("numbered")
    class Numbered extends CollectionEntity {
      @Id("number") id: number = 0;
      @Field("string") value: string = "";

      async save(): Promise<void> {
        throw new Error("Not bound");
      }
      async delete(): Promise<void> {
        throw new Error("Not bound");
      }
    }

    loader.create(Numbered, { id: 42, value: "original" });

    const item = await loader.modify(Numbered, 42, (n) => {
      n.value = "modified";
    });

    expect(item.value).toBe("modified");
  });
});

// --------------------------------------------------------------------------
// Edge cases
// --------------------------------------------------------------------------

describe("transaction edge cases", () => {
  test("nested manual transactions not supported (throws)", async () => {
    // SQLite doesn't support nested transactions in this way
    // This test documents the expected behavior
    await expect(
      loader.transaction(async () => {
        await loader.transaction(async () => {
          loader.create(TxAccount, { id: "a1" });
        });
      }),
    ).rejects.toThrow();
  });

  test("empty transaction succeeds", async () => {
    const result = await loader.transaction(async () => {
      return "empty";
    });

    expect(result).toBe("empty");
  });

  test("modify triggers save with updated_at", async () => {
    loader.create(TxAccount, { id: "a1", name: "Test", balance: 100 });

    await loader.modify(TxAccount, "a1", () => {
      // No-op - but modify() should still call save()
    });

    const row = db
      .prepare("SELECT updated_at FROM tx_accounts WHERE id = ?")
      .get("a1") as { updated_at: string };

    // Verify updated_at is set and is a valid timestamp
    expect(row.updated_at).toBeDefined();
    expect(new Date(row.updated_at).getTime()).not.toBeNaN();
  });

  test("transaction with only reads", async () => {
    loader.create(TxAccount, { id: "a1", name: "Test" });

    const result = await loader.transaction(async () => {
      const account = loader.get(TxAccount, "a1");
      return account?.name;
    });

    expect(result).toBe("Test");
  });
});
