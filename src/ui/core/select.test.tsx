import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { html } from "hono/html";
import { Field } from "./field-layout";
import { createIcon } from "./icon";
import { Select } from "./select";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });

async function render(element: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(html`${element}`));
  const res = await app.request("/");
  return res.text();
}

describe("Select", () => {
  it("renders a <select> element", async () => {
    const out = await render(
      <Select icon={icon}>
        <Select.Option value="a">Option A</Select.Option>
      </Select>,
    );
    expect(out).toContain("<select");
    expect(out).toContain('data-slot="select-wrapper"');
    expect(out).toContain('data-slot="select-icon"');
  });

  it("renders the chevron via a sprite <use> reference", async () => {
    const out = await render(
      <Select icon={icon}>
        <Select.Option value="a">Option A</Select.Option>
      </Select>,
    );
    expect(out).toContain("<use");
    expect(out).toContain('href="/sprite.svg#icon-chevron-down"');
  });

  it("renders child options", async () => {
    const out = await render(
      <Select icon={icon}>
        <Select.Option value="a">Option A</Select.Option>
        <Select.Option value="b">Option B</Select.Option>
      </Select>,
    );
    expect(out).toContain('value="a"');
    expect(out).toContain("Option A");
    expect(out).toContain('value="b"');
    expect(out).toContain("Option B");
  });

  it("passes through native attributes", async () => {
    const out = await render(
      <Select icon={icon} id="my-select" name="choice" required value="b">
        <Select.Option value="a">A</Select.Option>
        <Select.Option value="b" selected>B</Select.Option>
      </Select>,
    );
    expect(out).toContain('id="my-select"');
    expect(out).toContain('name="choice"');
    expect(out).toContain("required");
  });

  it("wires id and for via explicit field and name props", async () => {
    const out = await render(
      <Field name="choice">
        <Field.Label name="choice">Choice</Field.Label>
        <Field.Content>
          <Select icon={icon} field={{ name: "choice" }}>
            <Select.Option value="a">A</Select.Option>
          </Select>
        </Field.Content>
      </Field>,
    );
    expect(out).toContain('id="field-choice"');
    expect(out).toContain('for="field-choice"');
  });

  it("merges a custom class with the default classes", async () => {
    const out = await render(
      <Select icon={icon} class="extra">
        <Select.Option value="a">A</Select.Option>
      </Select>,
    );
    expect(out).toContain("extra");
    expect(out).toContain("w-full");
  });

  it("renders optgroups with explicit slots", async () => {
    const out = await render(
      <Select icon={icon}>
        <Select.OptGroup label="Group A">
          <Select.Option value="a">A</Select.Option>
        </Select.OptGroup>
      </Select>,
    );
    expect(out).toContain('data-slot="select-optgroup"');
    expect(out).toContain('data-slot="select-option"');
    expect(out).toContain('label="Group A"');
  });
});
