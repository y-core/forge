import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { html } from "hono/html";
import { Field, FieldContent, FieldLabel } from "./field";
import { Select, SelectOptGroup, SelectOption } from "./select";

async function render(element: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(html`${element}`));
  const res = await app.request("/");
  return res.text();
}

describe("Select", () => {
  it("renders a <select> element", async () => {
    const out = await render(
      <Select>
        <SelectOption value="a">Option A</SelectOption>
      </Select>,
    );
    expect(out).toContain("<select");
    expect(out).toContain('data-slot="select-wrapper"');
    expect(out).toContain('data-slot="select-icon"');
  });

  it("renders child options", async () => {
    const out = await render(
      <Select>
        <SelectOption value="a">Option A</SelectOption>
        <SelectOption value="b">Option B</SelectOption>
      </Select>,
    );
    expect(out).toContain('value="a"');
    expect(out).toContain("Option A");
    expect(out).toContain('value="b"');
    expect(out).toContain("Option B");
  });

  it("passes through native attributes", async () => {
    const out = await render(
      <Select id="my-select" name="choice" required value="b">
        <SelectOption value="a">A</SelectOption>
        <SelectOption value="b" selected>B</SelectOption>
      </Select>,
    );
    expect(out).toContain('id="my-select"');
    expect(out).toContain('name="choice"');
    expect(out).toContain("required");
  });

  it("inherits field wiring", async () => {
    const out = await render(
      <Field name="choice">
        <FieldLabel>Choice</FieldLabel>
        <FieldContent>
          <Select>
            <SelectOption value="a">A</SelectOption>
          </Select>
        </FieldContent>
      </Field>,
    );
    expect(out).toContain('id="field-choice"');
    expect(out).toContain('for="field-choice"');
  });

  it("merges a custom class with the default classes", async () => {
    const out = await render(
      <Select class="extra">
        <SelectOption value="a">A</SelectOption>
      </Select>,
    );
    expect(out).toContain("extra");
    expect(out).toContain("w-full");
  });

  it("renders optgroups with explicit slots", async () => {
    const out = await render(
      <Select>
        <SelectOptGroup label="Group A">
          <SelectOption value="a">A</SelectOption>
        </SelectOptGroup>
      </Select>,
    );
    expect(out).toContain('data-slot="select-optgroup"');
    expect(out).toContain('data-slot="select-option"');
    expect(out).toContain('label="Group A"');
  });
});
