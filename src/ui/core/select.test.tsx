import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { html } from "hono/html";
import { Select } from "./select";

async function render(element: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(html`${element}`));
  const res = await app.request("/");
  return res.text();
}

const OPTIONS = [
  { value: "a", label: "Option A" },
  { value: "b", label: "Option B" },
];

describe("Select", () => {
  it("renders a <select> element", async () => {
    const out = await render(<Select options={OPTIONS} />);
    expect(out).toContain("<select");
  });

  it("renders all provided options", async () => {
    const out = await render(<Select options={OPTIONS} />);
    expect(out).toContain('value="a"');
    expect(out).toContain("Option A");
    expect(out).toContain('value="b"');
    expect(out).toContain("Option B");
  });

  it("renders a placeholder option when provided", async () => {
    const out = await render(<Select options={OPTIONS} placeholder="Choose..." />);
    expect(out).toContain("Choose...");
    expect(out).toContain('value=""');
  });

  it("does not render a placeholder option when absent", async () => {
    const out = await render(<Select options={OPTIONS} />);
    expect(out).not.toContain('value=""');
  });

  it("marks the matching option as selected", async () => {
    const withValue = await render(<Select options={OPTIONS} value="b" />);
    const withoutValue = await render(<Select options={OPTIONS} />);
    expect(withValue).toContain("selected");
    expect(withoutValue).not.toContain("selected");
  });

  it("passes through id and name attributes", async () => {
    const out = await render(<Select options={OPTIONS} id="my-select" name="choice" />);
    expect(out).toContain('id="my-select"');
    expect(out).toContain('name="choice"');
  });

  it("merges a custom class with the default classes", async () => {
    const out = await render(<Select options={OPTIONS} class="extra" />);
    expect(out).toContain("extra");
    expect(out).toContain("w-full");
  });
});
