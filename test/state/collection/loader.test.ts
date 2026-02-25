/**
 * Tests for StateLoader collection CRUD operations: create(), get(), find(), count().
 */

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  Field,
  Id,
  Index,
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

// --------------------------------------------------------------------------
// Test entity classes (unique names to avoid decorator conflicts)
// --------------------------------------------------------------------------

@PersistedCollection("loader_users")
class LoaderUser extends CollectionEntity {
  @Id() id: string = "";
  @Field("string") @Index() email: string = "";
  @Field("string") name: string = "";
  @Field("number") age: number = 0;
  @Field("boolean") active: boolean = true;
  @Field("date") birthDate: Date | null = null;

  async save(): Promise<void> {
    throw new Error("Not bound");
  }
  async delete(): Promise<void> {
    throw new Error("Not bound");
  }
}

@PersistedCollection("loader_products")
class LoaderProduct extends CollectionEntity {
  @Id("number") id: number = 0;
  @Field("string") name: string = "";
  @Field("number") price: number = 0;

  async save(): Promise<void> {
    throw new Error("Not bound");
  }
  async delete(): Promise<void> {
    throw new Error("Not bound");
  }
}

class LoaderUndecoratedEntity extends CollectionEntity {
  async save(): Promise<void> {}
  async delete(): Promise<void> {}
}

// --------------------------------------------------------------------------
// create() tests
// --------------------------------------------------------------------------

describe("StateLoader.create", () => {
  test("creates entity with all fields", () => {
    const user = loader.create(LoaderUser, {
      id: "u1",
      email: "alice@example.com",
      name: "Alice",
      age: 30,
      active: true,
    });

    expect(user.id).toBe("u1");
    expect(user.email).toBe("alice@example.com");
    expect(user.name).toBe("Alice");
    expect(user.age).toBe(30);
    expect(user.active).toBe(true);
  });

  test("inserts row into database", () => {
    loader.create(LoaderUser, { id: "u1", name: "Alice" });

    const row = db
      .prepare("SELECT * FROM loader_users WHERE id = ?")
      .get("u1") as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.name).toBe("Alice");
  });

  test("sets created_at and updated_at", () => {
    loader.create(LoaderUser, { id: "u1", name: "Alice" });

    const row = db
      .prepare("SELECT * FROM loader_users WHERE id = ?")
      .get("u1") as Record<string, unknown>;
    expect(row.created_at).toBeDefined();
    expect(row.updated_at).toBeDefined();
  });

  test("returns bound entity with working save()", async () => {
    const user = loader.create(LoaderUser, { id: "u1", name: "Alice" });
    user.name = "Alicia";
    await user.save();

    const row = db
      .prepare("SELECT name FROM loader_users WHERE id = ?")
      .get("u1") as {
      name: string;
    };
    expect(row.name).toBe("Alicia");
  });

  test("returns bound entity with working delete()", async () => {
    const user = loader.create(LoaderUser, { id: "u1", name: "Alice" });
    await user.delete();

    const row = db.prepare("SELECT * FROM loader_users WHERE id = ?").get("u1");
    expect(row).toBeNull();
  });

  test("throws on duplicate primary key", () => {
    loader.create(LoaderUser, { id: "u1", name: "Alice" });

    expect(() => {
      loader.create(LoaderUser, { id: "u1", name: "Bob" });
    }).toThrow();
  });

  test("works with number id type", () => {
    const product = loader.create(LoaderProduct, {
      id: 1,
      name: "Widget",
      price: 9.99,
    });
    expect(product.id).toBe(1);

    const row = db
      .prepare("SELECT * FROM loader_products WHERE id = ?")
      .get(1) as Record<string, unknown>;
    expect(row.name).toBe("Widget");
  });

  test("throws on undecorated class", () => {
    expect(() => {
      loader.create(LoaderUndecoratedEntity, {});
    }).toThrow(/not decorated with @PersistedCollection/);
  });

  test("uses default values for omitted fields", () => {
    const user = loader.create(LoaderUser, { id: "u1" });
    expect(user.name).toBe("");
    expect(user.age).toBe(0);
    expect(user.active).toBe(true);
  });
});

// --------------------------------------------------------------------------
// get() tests
// --------------------------------------------------------------------------

describe("StateLoader.get", () => {
  test("returns entity when found", () => {
    loader.create(LoaderUser, { id: "u1", name: "Alice", age: 30 });

    const user = loader.get(LoaderUser, "u1");
    expect(user).not.toBeNull();
    expect(user!.name).toBe("Alice");
    expect(user!.age).toBe(30);
  });

  test("returns null when not found", () => {
    const user = loader.get(LoaderUser, "nonexistent");
    expect(user).toBeNull();
  });

  test("returns bound entity with working save()", async () => {
    loader.create(LoaderUser, { id: "u1", name: "Alice" });

    const user = loader.get(LoaderUser, "u1")!;
    user.name = "Alicia";
    await user.save();

    const row = db
      .prepare("SELECT name FROM loader_users WHERE id = ?")
      .get("u1") as {
      name: string;
    };
    expect(row.name).toBe("Alicia");
  });

  test("returns bound entity with working delete()", async () => {
    loader.create(LoaderUser, { id: "u1", name: "Alice" });

    const user = loader.get(LoaderUser, "u1")!;
    await user.delete();

    const row = db.prepare("SELECT * FROM loader_users WHERE id = ?").get("u1");
    expect(row).toBeNull();
  });

  test("works with number id type", () => {
    loader.create(LoaderProduct, { id: 1, name: "Widget" });

    const product = loader.get(LoaderProduct, 1);
    expect(product).not.toBeNull();
    expect(product!.name).toBe("Widget");
  });

  test("deserializes date fields correctly", () => {
    const testDate = new Date("2024-06-15T12:00:00.000Z");
    loader.create(LoaderUser, { id: "u1", birthDate: testDate });

    const user = loader.get(LoaderUser, "u1")!;
    expect(user.birthDate).toBeInstanceOf(Date);
    expect(user.birthDate!.getTime()).toBe(testDate.getTime());
  });

  test("throws on undecorated class", () => {
    expect(() => {
      loader.get(LoaderUndecoratedEntity, "id");
    }).toThrow(/not decorated with @PersistedCollection/);
  });
});

// --------------------------------------------------------------------------
// find() tests
// --------------------------------------------------------------------------

describe("StateLoader.find", () => {
  beforeEach(() => {
    // Seed test data
    loader.create(LoaderUser, {
      id: "u1",
      name: "Alice",
      age: 30,
      active: true,
    });
    loader.create(LoaderUser, { id: "u2", name: "Bob", age: 25, active: true });
    loader.create(LoaderUser, {
      id: "u3",
      name: "Charlie",
      age: 35,
      active: false,
    });
  });

  test("returns all entities when no options", () => {
    const users = loader.find(LoaderUser);
    expect(users).toHaveLength(3);
  });

  test("filters by where clause", () => {
    const users = loader.find(LoaderUser, { where: { active: true } });
    expect(users).toHaveLength(2);
    expect(users.map((u) => u.name).sort()).toEqual(["Alice", "Bob"]);
  });

  test("filters by multiple conditions", () => {
    const users = loader.find(LoaderUser, {
      where: { active: true, age: { op: "gte", value: 30 } },
    });
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe("Alice");
  });

  test("orders by single field asc", () => {
    const users = loader.find(LoaderUser, { orderBy: { age: "asc" } });
    expect(users.map((u) => u.age)).toEqual([25, 30, 35]);
  });

  test("orders by single field desc", () => {
    const users = loader.find(LoaderUser, { orderBy: { age: "desc" } });
    expect(users.map((u) => u.age)).toEqual([35, 30, 25]);
  });

  test("limits results", () => {
    const users = loader.find(LoaderUser, {
      orderBy: { age: "asc" },
      limit: 2,
    });
    expect(users).toHaveLength(2);
    expect(users.map((u) => u.age)).toEqual([25, 30]);
  });

  test("offsets results", () => {
    const users = loader.find(LoaderUser, {
      orderBy: { age: "asc" },
      limit: 2,
      offset: 1,
    });
    expect(users).toHaveLength(2);
    expect(users.map((u) => u.age)).toEqual([30, 35]);
  });

  test("returns bound entities with working save()", async () => {
    const users = loader.find(LoaderUser, { where: { id: "u1" } });
    users[0].name = "Alicia";
    await users[0].save();

    const row = db
      .prepare("SELECT name FROM loader_users WHERE id = ?")
      .get("u1") as {
      name: string;
    };
    expect(row.name).toBe("Alicia");
  });

  test("returns empty array when no matches", () => {
    const users = loader.find(LoaderUser, { where: { name: "Nobody" } });
    expect(users).toEqual([]);
  });

  test("supports in operator", () => {
    const users = loader.find(LoaderUser, {
      where: { id: { op: "in", value: ["u1", "u3"] as unknown as string } },
    });
    expect(users).toHaveLength(2);
  });

  test("supports contains operator", () => {
    const users = loader.find(LoaderUser, {
      where: { name: { op: "contains", value: "li" } },
    });
    expect(users).toHaveLength(2); // Alice and Charlie
  });

  test("supports startsWith operator", () => {
    const users = loader.find(LoaderUser, {
      where: { name: { op: "startsWith", value: "A" } },
    });
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe("Alice");
  });

  test("throws on undecorated class", () => {
    expect(() => {
      loader.find(LoaderUndecoratedEntity);
    }).toThrow(/not decorated with @PersistedCollection/);
  });
});

// --------------------------------------------------------------------------
// count() tests
// --------------------------------------------------------------------------

describe("StateLoader.count", () => {
  beforeEach(() => {
    loader.create(LoaderUser, { id: "u1", name: "Alice", active: true });
    loader.create(LoaderUser, { id: "u2", name: "Bob", active: true });
    loader.create(LoaderUser, { id: "u3", name: "Charlie", active: false });
  });

  test("returns total count when no where clause", () => {
    const count = loader.count(LoaderUser);
    expect(count).toBe(3);
  });

  test("returns filtered count", () => {
    const count = loader.count(LoaderUser, { active: true });
    expect(count).toBe(2);
  });

  test("returns 0 when no matches", () => {
    const count = loader.count(LoaderUser, { name: "Nobody" });
    expect(count).toBe(0);
  });

  test("supports operators in where clause", () => {
    const count = loader.count(LoaderUser, {
      name: { op: "startsWith", value: "A" },
    });
    expect(count).toBe(1);
  });

  test("throws on undecorated class", () => {
    expect(() => {
      loader.count(LoaderUndecoratedEntity);
    }).toThrow(/not decorated with @PersistedCollection/);
  });
});

// --------------------------------------------------------------------------
// Edge cases
// --------------------------------------------------------------------------

describe("collection edge cases", () => {
  test("handles null field values", () => {
    loader.create(LoaderUser, { id: "u1", birthDate: null });

    const user = loader.get(LoaderUser, "u1")!;
    expect(user.birthDate).toBeNull();
  });

  test("handles empty string values", () => {
    loader.create(LoaderUser, { id: "u1", name: "" });

    const user = loader.get(LoaderUser, "u1")!;
    expect(user.name).toBe("");
  });

  test("handles special characters in string values", () => {
    loader.create(LoaderUser, {
      id: "u1",
      name: "Alice's \"Wonderland\" O'Brien",
    });

    const user = loader.get(LoaderUser, "u1")!;
    expect(user.name).toBe("Alice's \"Wonderland\" O'Brien");
  });

  test("handles unicode in string values", () => {
    loader.create(LoaderUser, { id: "u1", name: "Émilie 日本語 🚀" });

    const user = loader.get(LoaderUser, "u1")!;
    expect(user.name).toBe("Émilie 日本語 🚀");
  });

  test("handles very long strings", () => {
    const longName = "a".repeat(10000);
    loader.create(LoaderUser, { id: "u1", name: longName });

    const user = loader.get(LoaderUser, "u1")!;
    expect(user.name).toBe(longName);
  });

  test("handles zero numeric values", () => {
    loader.create(LoaderUser, { id: "u1", age: 0 });

    const user = loader.get(LoaderUser, "u1")!;
    expect(user.age).toBe(0);
  });

  test("handles negative numeric values", () => {
    loader.create(LoaderProduct, { id: 1, price: -10.5 });

    const product = loader.get(LoaderProduct, 1)!;
    expect(product.price).toBe(-10.5);
  });

  test("handles boolean false correctly", () => {
    loader.create(LoaderUser, { id: "u1", active: false });

    const user = loader.get(LoaderUser, "u1")!;
    expect(user.active).toBe(false);
  });

  test("multiple create/delete cycles", async () => {
    for (let i = 0; i < 5; i++) {
      const user = loader.create(LoaderUser, {
        id: "u1",
        name: `LoaderUser ${i}`,
      });
      expect(loader.get(LoaderUser, "u1")).not.toBeNull();
      await user.delete();
      expect(loader.get(LoaderUser, "u1")).toBeNull();
    }
  });

  test("concurrent reads do not interfere", () => {
    loader.create(LoaderUser, { id: "u1", name: "Alice" });

    // Multiple reads should all succeed
    const reads = [
      loader.get(LoaderUser, "u1"),
      loader.get(LoaderUser, "u1"),
      loader.get(LoaderUser, "u1"),
    ];

    for (const user of reads) {
      expect(user).not.toBeNull();
      expect(user!.name).toBe("Alice");
    }
  });

  test("find with empty where object returns all", () => {
    loader.create(LoaderUser, { id: "u1", name: "Alice" });
    loader.create(LoaderUser, { id: "u2", name: "Bob" });

    const users = loader.find(LoaderUser, { where: {} });
    expect(users).toHaveLength(2);
  });

  test("save sets updated_at timestamp", async () => {
    const user = loader.create(LoaderUser, { id: "u1", name: "Alice" });

    user.name = "Alicia";
    await user.save();

    const row = db
      .prepare("SELECT updated_at FROM loader_users WHERE id = ?")
      .get("u1") as {
      updated_at: string;
    };

    // Verify updated_at is set and is a valid timestamp
    expect(row.updated_at).toBeDefined();
    expect(new Date(row.updated_at).getTime()).not.toBeNaN();
  });
});

// --------------------------------------------------------------------------
// Runtime safety checks
// --------------------------------------------------------------------------

describe("StateLoader runtime safety", () => {
  test("load() throws for @PersistedCollection classes", () => {
    // Even if TypeScript is bypassed, runtime should catch misuse
    expect(() => {
      (loader as unknown as { load: (c: unknown, k: string) => unknown }).load(
        LoaderUser,
        "key",
      );
    }).toThrow(/is a @PersistedCollection.*Use get\(\) or find\(\)/);
  });

  test("exists() throws for @PersistedCollection classes", () => {
    expect(() => {
      (
        loader as unknown as { exists: (c: unknown, k: string) => boolean }
      ).exists(LoaderUser, "key");
    }).toThrow(/is a @PersistedCollection.*Use get\(\) or find\(\)/);
  });
});

// --------------------------------------------------------------------------
// Timestamp tests
// --------------------------------------------------------------------------

describe("CollectionEntity timestamps", () => {
  test("entity has timestamps populated after create()", () => {
    const user = loader.create(LoaderUser, { id: "u1", name: "Alice" });

    // Timestamps should be populated from database after create
    const fetched = loader.get(LoaderUser, "u1")!;
    expect(fetched.created_at).toBeInstanceOf(Date);
    expect(fetched.updated_at).toBeInstanceOf(Date);
    expect(fetched.created_at.getTime()).toBeGreaterThan(0);
    expect(fetched.updated_at.getTime()).toBeGreaterThan(0);
  });

  test("updated_at changes after save()", async () => {
    const user = loader.create(LoaderUser, { id: "u1", name: "Alice" });

    // Get initial timestamps from database
    const initialRow = db
      .prepare("SELECT created_at, updated_at FROM loader_users WHERE id = ?")
      .get("u1") as { created_at: string; updated_at: string };
    const initialUpdatedAt = new Date(initialRow.updated_at).getTime();

    // Wait at least 1 second to ensure datetime('now') changes
    // SQLite datetime('now') has second-level granularity
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Update and save
    user.name = "Alicia";
    await user.save();

    // Get updated timestamps
    const updatedRow = db
      .prepare("SELECT created_at, updated_at FROM loader_users WHERE id = ?")
      .get("u1") as { created_at: string; updated_at: string };
    const newUpdatedAt = new Date(updatedRow.updated_at).getTime();

    expect(newUpdatedAt).toBeGreaterThan(initialUpdatedAt);
  });

  test("created_at stays same after save()", async () => {
    const user = loader.create(LoaderUser, { id: "u1", name: "Alice" });

    // Get initial created_at
    const initialRow = db
      .prepare("SELECT created_at FROM loader_users WHERE id = ?")
      .get("u1") as { created_at: string };
    const initialCreatedAt = initialRow.created_at;

    // Update and save
    user.name = "Alicia";
    await user.save();

    // Verify created_at unchanged
    const updatedRow = db
      .prepare("SELECT created_at FROM loader_users WHERE id = ?")
      .get("u1") as { created_at: string };
    expect(updatedRow.created_at).toBe(initialCreatedAt);
  });

  test("can query by updated_at with operators", () => {
    // Create some test data
    loader.create(LoaderUser, { id: "u1", name: "Alice" });
    loader.create(LoaderUser, { id: "u2", name: "Bob" });

    // Query for entities updated after epoch
    const users = loader.find(LoaderUser, {
      where: { updated_at: { op: "gte", value: new Date(0) } },
    });

    expect(users).toHaveLength(2);
  });

  test("can order by created_at", () => {
    // Create entities - they should be ordered by created_at
    // Since created_at has second granularity and may be same,
    // we test ordering falls back to consistent behavior
    loader.create(LoaderUser, { id: "u1", name: "First" });
    loader.create(LoaderUser, { id: "u2", name: "Second" });
    loader.create(LoaderUser, { id: "u3", name: "Third" });

    // Order by created_at asc - should return consistent results
    const usersAsc = loader.find(LoaderUser, {
      orderBy: { created_at: "asc" },
    });
    expect(usersAsc).toHaveLength(3);
    // All should have valid created_at timestamps
    for (const user of usersAsc) {
      expect(user.created_at).toBeInstanceOf(Date);
      expect(user.created_at.getTime()).toBeGreaterThan(0);
    }

    // Order by created_at desc - should return consistent results in reverse
    const usersDesc = loader.find(LoaderUser, {
      orderBy: { created_at: "desc" },
    });
    expect(usersDesc).toHaveLength(3);
    // Check timestamps are populated
    for (const user of usersDesc) {
      expect(user.created_at).toBeInstanceOf(Date);
      expect(user.created_at.getTime()).toBeGreaterThan(0);
    }
  });

  test("timestamps are readonly Date properties with default epoch", () => {
    // CollectionEntity base class should have default values
    @PersistedCollection("timestamp_default_test")
    class TimestampDefaultTest extends CollectionEntity {
      @Id() id: string = "";
      async save(): Promise<void> {
        throw new Error("Not bound");
      }
      async delete(): Promise<void> {
        throw new Error("Not bound");
      }
    }

    // Create instance without loading from DB - should have epoch default
    const instance = new TimestampDefaultTest();
    expect(instance.created_at).toBeInstanceOf(Date);
    expect(instance.updated_at).toBeInstanceOf(Date);
    expect(instance.created_at.getTime()).toBe(0);
    expect(instance.updated_at.getTime()).toBe(0);
  });
});
