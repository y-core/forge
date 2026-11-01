import { describe, expect, it } from "bun:test";

import { v } from "../../validation/validation";
import { jsonTable } from "./schema";

const Schema = jsonTable(v.object({ items: v.optional(v.array(v.string()), []) }), "must be a table");

describe("jsonTable", () => {
  it("passes an object to the schema it wraps", () => {
    expect(v.parse(Schema, { items: ["a"] })).toEqual({ items: ["a"] });
    expect(v.parse(Schema, {})).toEqual({ items: [] });
  });

  it("refuses an array, which a bare object schema accepts", () => {
    expect(v.is(v.object({ items: v.optional(v.array(v.string()), []) }), [])).toBe(true);
    const result = v.safeParse(Schema, []);
    expect(result.success).toBe(false);
    expect(result.issues?.map((issue) => issue.message)).toEqual(["must be a table"]);
  });

  it("leaves a non-object to the wrapped schema's own refusal", () => {
    const result = v.safeParse(Schema, "x");
    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
  });
});
