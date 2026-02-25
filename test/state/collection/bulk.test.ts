/**
 * Tests for StateLoader bulk operations: upsert(), updateWhere(), deleteWhere().
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

@PersistedCollection("bulk_items")
class BulkItem extends CollectionEntity {
  @Id() id: string = "";
  @Field("string") @Index() status: string = "pending";
  @Field("string") name: string = "";
  @Field("number") quantity: number = 0;

  async save(): Promise<void> {
    throw new Error("Not bound");
  }
  async delete(): Promise<void> {
    throw new Error("Not bound");
  }
}

// --------------------------------------------------------------------------
// upsert() tests
// --------------------------------------------------------------------------

describe("StateLoader.upsert", () => {
  test("inserts new entity when not exists", () => {
    const item = loader.upsert(BulkItem, {
      id: "i1",
      name: "Widget",
      quantity: 10,
    });

    expect(item.id).toBe("i1");
    expect(item.name).toBe("Widget");
    expect(item.quantity).toBe(10);

    const row = db
      .prepare("SELECT * FROM bulk_items WHERE id = ?")
      .get("i1") as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.name).toBe("Widget");
  });

  test("replaces existing entity", () => {
    loader.create(BulkItem, { id: "i1", name: "Widget", quantity: 10 });

    const item = loader.upsert(BulkItem, {
      id: "i1",
      name: "Gadget",
      quantity: 5,
    });

    expect(item.name).toBe("Gadget");
    expect(item.quantity).toBe(5);

    const row = db
      .prepare("SELECT * FROM bulk_items WHERE id = ?")
      .get("i1") as Record<string, unknown>;
    expect(row.name).toBe("Gadget");
    expect(row.quantity).toBe(5);
  });

  test("returns bound entity with working save()", async () => {
    const item = loader.upsert(BulkItem, { id: "i1", name: "Widget" });
    item.name = "Updated Widget";
    await item.save();

    const row = db
      .prepare("SELECT name FROM bulk_items WHERE id = ?")
      .get("i1") as {
      name: string;
    };
    expect(row.name).toBe("Updated Widget");
  });

  test("returns bound entity with working delete()", async () => {
    const item = loader.upsert(BulkItem, { id: "i1", name: "Widget" });
    await item.delete();

    const row = db.prepare("SELECT * FROM bulk_items WHERE id = ?").get("i1");
    expect(row).toBeNull();
  });

  test("preserves count after multiple upserts", () => {
    loader.upsert(BulkItem, { id: "i1", name: "V1" });
    loader.upsert(BulkItem, { id: "i1", name: "V2" });
    loader.upsert(BulkItem, { id: "i1", name: "V3" });

    expect(loader.count(BulkItem)).toBe(1);
    expect(loader.get(BulkItem, "i1")!.name).toBe("V3");
  });

  test("preserves created_at on upsert update", () => {
    // Create initial entity to ensure table exists
    loader.create(BulkItem, { id: "setup", name: "Setup" });

    // Insert a row with a known old created_at timestamp
    const oldTimestamp = "2020-01-01 00:00:00";
    db.exec(`
      INSERT INTO bulk_items (id, name, status, quantity, created_at, updated_at)
      VALUES ('i1', 'Original', 'pending', 0, '${oldTimestamp}', '${oldTimestamp}')
    `);

    // Upsert the same entity with new data
    loader.upsert(BulkItem, { id: "i1", name: "Updated", quantity: 5 });

    // Verify created_at is preserved but data and updated_at changed
    const row = db
      .prepare(
        "SELECT created_at, updated_at, name, quantity FROM bulk_items WHERE id = ?",
      )
      .get("i1") as {
      created_at: string;
      updated_at: string;
      name: string;
      quantity: number;
    };

    expect(row.name).toBe("Updated");
    expect(row.quantity).toBe(5);
    expect(row.created_at).toBe(oldTimestamp); // Preserved!
    expect(row.updated_at).not.toBe(oldTimestamp); // Updated to now
  });
});

// --------------------------------------------------------------------------
// updateWhere() tests
// --------------------------------------------------------------------------

describe("StateLoader.updateWhere", () => {
  beforeEach(() => {
    loader.create(BulkItem, {
      id: "i1",
      name: "A",
      status: "pending",
      quantity: 1,
    });
    loader.create(BulkItem, {
      id: "i2",
      name: "B",
      status: "pending",
      quantity: 2,
    });
    loader.create(BulkItem, {
      id: "i3",
      name: "C",
      status: "active",
      quantity: 3,
    });
  });

  test("updates matching rows", () => {
    const count = loader.updateWhere(
      BulkItem,
      { status: "pending" },
      { status: "active" },
    );

    expect(count).toBe(2);

    const items = loader.find(BulkItem, { where: { status: "active" } });
    expect(items).toHaveLength(3);
  });

  test("returns count of updated rows", () => {
    const count = loader.updateWhere(
      BulkItem,
      { status: "pending" },
      { quantity: 100 },
    );
    expect(count).toBe(2);
  });

  test("returns 0 when no matches", () => {
    const count = loader.updateWhere(
      BulkItem,
      { status: "deleted" },
      { quantity: 0 },
    );
    expect(count).toBe(0);
  });

  test("updates multiple fields", () => {
    loader.updateWhere(
      BulkItem,
      { id: "i1" },
      { name: "Updated", quantity: 99 },
    );

    const item = loader.get(BulkItem, "i1")!;
    expect(item.name).toBe("Updated");
    expect(item.quantity).toBe(99);
  });

  test("supports operators in where clause", () => {
    const count = loader.updateWhere(
      BulkItem,
      { quantity: { op: "lt", value: 3 } },
      { status: "low" },
    );

    expect(count).toBe(2);
  });

  test("updates updated_at timestamp", () => {
    loader.updateWhere(BulkItem, { id: "i1" }, { name: "Changed" });

    const row = db
      .prepare("SELECT updated_at FROM bulk_items WHERE id = ?")
      .get("i1") as {
      updated_at: string;
    };

    // Verify updated_at is set and is a valid timestamp
    expect(row.updated_at).toBeDefined();
    expect(new Date(row.updated_at).getTime()).not.toBeNaN();
  });
});

// --------------------------------------------------------------------------
// deleteWhere() tests
// --------------------------------------------------------------------------

describe("StateLoader.deleteWhere", () => {
  beforeEach(() => {
    loader.create(BulkItem, { id: "i1", status: "pending", quantity: 1 });
    loader.create(BulkItem, { id: "i2", status: "pending", quantity: 2 });
    loader.create(BulkItem, { id: "i3", status: "active", quantity: 3 });
  });

  test("deletes matching rows", () => {
    const count = loader.deleteWhere(BulkItem, { status: "pending" });

    expect(count).toBe(2);
    expect(loader.count(BulkItem)).toBe(1);
  });

  test("returns count of deleted rows", () => {
    const count = loader.deleteWhere(BulkItem, { status: "pending" });
    expect(count).toBe(2);
  });

  test("returns 0 when no matches", () => {
    const count = loader.deleteWhere(BulkItem, { status: "deleted" });
    expect(count).toBe(0);
  });

  test("supports operators in where clause", () => {
    const count = loader.deleteWhere(BulkItem, {
      quantity: { op: "lte", value: 2 },
    });

    expect(count).toBe(2);
    expect(loader.count(BulkItem)).toBe(1);
    expect(loader.get(BulkItem, "i3")).not.toBeNull();
  });

  test("deletes all when no where clause", () => {
    const count = loader.deleteWhere(BulkItem, undefined);

    expect(count).toBe(3);
    expect(loader.count(BulkItem)).toBe(0);
  });

  test("deletes all with empty where object", () => {
    const count = loader.deleteWhere(BulkItem, {});

    expect(count).toBe(3);
    expect(loader.count(BulkItem)).toBe(0);
  });
});

// --------------------------------------------------------------------------
// Edge cases for bulk operations
// --------------------------------------------------------------------------

describe("bulk operations edge cases", () => {
  test("upsert with null field values", () => {
    @PersistedCollection("nullable_items")
    class NullableItem extends CollectionEntity {
      @Id() id: string = "";
      @Field("date") deletedAt: Date | null = null;

      async save(): Promise<void> {}
      async delete(): Promise<void> {}
    }

    const item = loader.upsert(NullableItem, { id: "n1", deletedAt: null });
    expect(item.deletedAt).toBeNull();
  });

  test("updateWhere with empty updates object", () => {
    loader.create(BulkItem, { id: "i1", name: "Test" });

    // Empty updates should still update timestamp
    const count = loader.updateWhere(BulkItem, { id: "i1" }, {});
    expect(count).toBe(1);
  });

  test("deleteWhere with in operator", () => {
    loader.create(BulkItem, { id: "i1" });
    loader.create(BulkItem, { id: "i2" });
    loader.create(BulkItem, { id: "i3" });

    const count = loader.deleteWhere(BulkItem, {
      id: { op: "in", value: ["i1", "i3"] as unknown as string },
    });
    expect(count).toBe(2);
    expect(loader.count(BulkItem)).toBe(1);
    expect(loader.get(BulkItem, "i2")).not.toBeNull();
  });

  test("large batch upsert", () => {
    for (let i = 0; i < 100; i++) {
      loader.upsert(BulkItem, { id: `item-${i}`, name: `BulkItem ${i}` });
    }

    expect(loader.count(BulkItem)).toBe(100);
  });

  test("updateWhere updates many rows", () => {
    for (let i = 0; i < 50; i++) {
      loader.create(BulkItem, { id: `i${i}`, status: "old" });
    }

    const count = loader.updateWhere(
      BulkItem,
      { status: "old" },
      { status: "new" },
    );
    expect(count).toBe(50);
    expect(loader.count(BulkItem, { status: "new" })).toBe(50);
  });
});
