/**
 * Tests for @PersistedCollection, @Id, @Field, and @Index decorators.
 */

import { describe, expect, test } from "bun:test";
import {
  Field,
  Id,
  Index,
  PersistedCollection,
} from "../../../src/state/collection/decorators";
import {
  CollectionEntity,
  collectionMeta,
} from "../../../src/state/collection/types";

describe("@PersistedCollection", () => {
  test("stores table name in metadata", () => {
    @PersistedCollection("pc_table_1")
    class TestCollection extends CollectionEntity {
      @Id() id: string = "";
      async save(): Promise<void> {}
      async delete(): Promise<void> {}
    }

    const meta = collectionMeta.get(TestCollection);
    expect(meta).toBeDefined();
    expect(meta!.table).toBe("pc_table_1");
  });

  test("throws when @Id is missing", () => {
    expect(() => {
      @PersistedCollection("no_id_table")
      class _NoIdCollection extends CollectionEntity {
        @Field("string") name: string = "";
        async save(): Promise<void> {}
        async delete(): Promise<void> {}
      }
    }).toThrow(/must have exactly one @Id field/);
  });

  test("throws on extending @PersistedCollection class", () => {
    @PersistedCollection("pc_parent_table")
    class ParentCollection extends CollectionEntity {
      @Id() id: string = "";
      async save(): Promise<void> {}
      async delete(): Promise<void> {}
    }

    expect(() => {
      @PersistedCollection("pc_child_table")
      class _ChildCollection extends ParentCollection {
        @Field("string") extra: string = "";
      }
    }).toThrow(/cannot extend @PersistedCollection class/);
  });

  test("inheritance error includes class and table names", () => {
    @PersistedCollection("pc_parent_detail")
    class ParentDetail extends CollectionEntity {
      @Id() id: string = "";
      async save(): Promise<void> {}
      async delete(): Promise<void> {}
    }

    try {
      @PersistedCollection("pc_child_detail")
      class _ChildDetail extends ParentDetail {
        @Field("string") extra: string = "";
      }
      expect(true).toBe(false);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("ParentDetail");
      expect(msg).toContain("pc_parent_detail");
    }
  });

  test("accessing metadata on undecorated class returns undefined", () => {
    class UndecoratedEntity extends CollectionEntity {
      async save(): Promise<void> {}
      async delete(): Promise<void> {}
    }

    const meta = collectionMeta.get(UndecoratedEntity);
    expect(meta).toBeUndefined();
  });
});

describe("@Id", () => {
  test("registers id property and column", () => {
    @PersistedCollection("id_test_1")
    class IdTest extends CollectionEntity {
      @Id() userId: string = "";
      async save(): Promise<void> {}
      async delete(): Promise<void> {}
    }

    const meta = collectionMeta.get(IdTest);
    expect(meta!.idProperty).toBe("userId");
    expect(meta!.idColumn).toBe("id");
    expect(meta!.idType).toBe("string");
  });

  test("custom column name", () => {
    @PersistedCollection("id_custom_col")
    class IdCustomCol extends CollectionEntity {
      @Id("string", { column: "user_uuid" }) uid: string = "";
      async save(): Promise<void> {}
      async delete(): Promise<void> {}
    }

    const meta = collectionMeta.get(IdCustomCol);
    expect(meta!.idColumn).toBe("user_uuid");
  });

  test("number type id", () => {
    @PersistedCollection("id_number_type")
    class IdNumberType extends CollectionEntity {
      @Id("number") id: number = 0;
      async save(): Promise<void> {}
      async delete(): Promise<void> {}
    }

    const meta = collectionMeta.get(IdNumberType);
    expect(meta!.idType).toBe("number");
  });

  test("throws on multiple @Id decorators", () => {
    expect(() => {
      @PersistedCollection("multi_id_table")
      class _MultiIdClass extends CollectionEntity {
        @Id() id1: string = "";
        @Id() id2: string = "";
        async save(): Promise<void> {}
        async delete(): Promise<void> {}
      }
    }).toThrow(/Multiple @Id decorators found in/);
  });
});

describe("@Index", () => {
  test("single column index", () => {
    @PersistedCollection("idx_single")
    class IdxSingle extends CollectionEntity {
      @Id() id: string = "";
      @Field("string") @Index() email: string = "";
      async save(): Promise<void> {}
      async delete(): Promise<void> {}
    }

    const meta = collectionMeta.get(IdxSingle);
    expect(meta!.indices).toHaveLength(1);
    expect(meta!.indices[0].columns).toEqual(["email"]);
  });

  test("multiple @Index decorators", () => {
    @PersistedCollection("idx_multi")
    class IdxMulti extends CollectionEntity {
      @Id() id: string = "";
      @Field("string") @Index() email: string = "";
      @Field("string") @Index() name: string = "";
      async save(): Promise<void> {}
      async delete(): Promise<void> {}
    }

    const meta = collectionMeta.get(IdxMulti);
    expect(meta!.indices).toHaveLength(2);
  });

  test("composite index with array", () => {
    @PersistedCollection("idx_composite")
    class IdxComposite extends CollectionEntity {
      @Id() id: string = "";
      @Field("string") @Index(["status", "createdAt"]) status: string = "";
      @Field("date") createdAt: Date | null = null;
      async save(): Promise<void> {}
      async delete(): Promise<void> {}
    }

    const meta = collectionMeta.get(IdxComposite);
    expect(meta!.indices[0].columns).toEqual(["status", "created_at"]);
  });

  test("single string column for composite index", () => {
    @PersistedCollection("idx_string_composite")
    class IdxStringComposite extends CollectionEntity {
      @Id() id: string = "";
      @Field("string") @Index("userName") status: string = "";
      async save(): Promise<void> {}
      async delete(): Promise<void> {}
    }

    const meta = collectionMeta.get(IdxStringComposite);
    expect(meta!.indices[0].columns).toEqual(["user_name"]);
  });
});

describe("@Field (collection)", () => {
  test("registers field with property name", () => {
    @PersistedCollection("field_coll_1")
    class FieldColl extends CollectionEntity {
      @Id() id: string = "";
      @Field("string") myProperty: string = "";
      async save(): Promise<void> {}
      async delete(): Promise<void> {}
    }

    const meta = collectionMeta.get(FieldColl);
    expect(meta!.fields.has("myProperty")).toBe(true);
    expect(meta!.fields.get("myProperty")!.property).toBe("myProperty");
  });

  test("snake_case column name default", () => {
    @PersistedCollection("snake_coll_1")
    class SnakeColl extends CollectionEntity {
      @Id() id: string = "";
      @Field("string") myFieldName: string = "";
      async save(): Promise<void> {}
      async delete(): Promise<void> {}
    }

    const meta = collectionMeta.get(SnakeColl);
    expect(meta!.fields.get("myFieldName")!.column).toBe("my_field_name");
  });

  test("custom column override", () => {
    @PersistedCollection("custom_col_coll")
    class CustomColColl extends CollectionEntity {
      @Id() id: string = "";
      @Field("string", { column: "custom_column" }) myField: string = "";
      async save(): Promise<void> {}
      async delete(): Promise<void> {}
    }

    const meta = collectionMeta.get(CustomColColl);
    expect(meta!.fields.get("myField")!.column).toBe("custom_column");
  });

  test("all field types supported", () => {
    @PersistedCollection("all_types_coll")
    class AllTypesColl extends CollectionEntity {
      @Id() id: string = "";
      @Field("string") str: string = "";
      @Field("number") num: number = 0;
      @Field("boolean") bool: boolean = false;
      @Field("date") dt: Date | null = null;
      async save(): Promise<void> {}
      async delete(): Promise<void> {}
    }

    const meta = collectionMeta.get(AllTypesColl);
    expect(meta!.fields.get("str")!.type).toBe("string");
    expect(meta!.fields.get("num")!.type).toBe("number");
    expect(meta!.fields.get("bool")!.type).toBe("boolean");
    expect(meta!.fields.get("dt")!.type).toBe("date");
  });
});
