/**
 * Tests for @Persisted and @Field decorators.
 */

import { describe, expect, test } from "bun:test";
import { Field, Persisted } from "../../src/state/decorators";
import { classMeta } from "../../src/state/types";

describe("@Persisted", () => {
  test("stores table name in metadata", () => {
    @Persisted("test_table_1")
    class TestState {
      @Field("string") value: string = "";
    }

    const meta = classMeta.get(TestState);
    expect(meta).toBeDefined();
    expect(meta!.table).toBe("test_table_1");
  });

  test("class extending @Persisted class throws error", () => {
    @Persisted("parent_table_3")
    class ParentState {
      @Field("string") value: string = "";
    }

    expect(() => {
      @Persisted("child_table_3")
      class _ChildState extends ParentState {
        @Field("string") extra: string = "";
      }
    }).toThrow(/cannot extend @Persisted class/);
  });

  test("class extending plain class is allowed", () => {
    class PlainBase {
      baseValue = 42;
    }

    expect(() => {
      @Persisted("derived_table_1")
      class _DerivedState extends PlainBase {
        @Field("string") value: string = "";
      }
    }).not.toThrow();
  });

  test("inheritance error message includes both class names", () => {
    @Persisted("parent_table_4")
    class ParentState4 {
      @Field("string") value: string = "";
    }

    try {
      @Persisted("child_table_4")
      class _ChildState4 extends ParentState4 {
        @Field("string") extra: string = "";
      }
      expect(true).toBe(false); // Should not reach here
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("ParentState4");
      expect(msg).toContain("parent_table_4");
    }
  });

  test("accessing metadata on undecorated class returns undefined", () => {
    class UndecoratedClass {
      value = 42;
    }

    const meta = classMeta.get(UndecoratedClass);
    expect(meta).toBeUndefined();
  });
});

describe("@Field", () => {
  test("registers field with property name", () => {
    @Persisted("field_test_1")
    class FieldTest {
      @Field("string") myProperty: string = "";
    }

    const meta = classMeta.get(FieldTest);
    expect(meta!.fields.has("myProperty")).toBe(true);
    expect(meta!.fields.get("myProperty")!.property).toBe("myProperty");
  });

  test("stores string type", () => {
    @Persisted("string_type_1")
    class StringType {
      @Field("string") name: string = "default";
    }

    const meta = classMeta.get(StringType);
    expect(meta!.fields.get("name")!.type).toBe("string");
  });

  test("stores number type", () => {
    @Persisted("number_type_1")
    class NumberType {
      @Field("number") count: number = 0;
    }

    const meta = classMeta.get(NumberType);
    expect(meta!.fields.get("count")!.type).toBe("number");
  });

  test("stores boolean type", () => {
    @Persisted("boolean_type_1")
    class BooleanType {
      @Field("boolean") enabled: boolean = false;
    }

    const meta = classMeta.get(BooleanType);
    expect(meta!.fields.get("enabled")!.type).toBe("boolean");
  });

  test("stores date type", () => {
    @Persisted("date_type_1")
    class DateType {
      @Field("date") createdAt: Date = new Date();
    }

    const meta = classMeta.get(DateType);
    expect(meta!.fields.get("createdAt")!.type).toBe("date");
  });

  test("explicit type works with null default", () => {
    @Persisted("null_with_type_1")
    class NullWithType {
      @Field("string") value: string | null = null;
    }

    const meta = classMeta.get(NullWithType);
    expect(meta!.fields.get("value")!.type).toBe("string");
  });

  test("column option overrides column name", () => {
    @Persisted("column_override_1")
    class ColumnOverride {
      @Field("string", { column: "custom_col" }) myField: string = "";
    }

    const meta = classMeta.get(ColumnOverride);
    expect(meta!.fields.get("myField")!.column).toBe("custom_col");
  });

  test("default column name is snake_case", () => {
    @Persisted("snake_case_1")
    class SnakeCase {
      @Field("string") myFieldName: string = "";
    }

    const meta = classMeta.get(SnakeCase);
    expect(meta!.fields.get("myFieldName")!.column).toBe("my_field_name");
  });

  test("multiple @Field decorators on same class", () => {
    @Persisted("multi_field_1")
    class MultiField {
      @Field("string") name: string = "";
      @Field("number") count: number = 0;
      @Field("boolean") enabled: boolean = true;
    }

    const meta = classMeta.get(MultiField);
    expect(meta!.fields.size).toBe(3);
    expect(meta!.fields.has("name")).toBe(true);
    expect(meta!.fields.has("count")).toBe(true);
    expect(meta!.fields.has("enabled")).toBe(true);
  });
});
