import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { html } from "hono/html";
import { Progress } from "./progress";

async function render(element: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(html`${element}`));
  const res = await app.request("/");
  return res.text();
}

describe("Progress", () => {
  it("renders a <progress> element with data-slot=progress", async () => {
    const out = await render(<Progress />);
    expect(out).toContain("<progress");
    expect(out).toContain('data-slot="progress"');
  });

  it("renders value and max attributes", async () => {
    const out = await render(<Progress value={50} max={100} />);
    expect(out).toContain('value="50"');
    expect(out).toContain('max="100"');
  });

  it("renders aria-label from the label convenience prop", async () => {
    const out = await render(<Progress label="Upload progress" />);
    expect(out).toContain('aria-label="Upload progress"');
  });

  it("renders aria-label directly when provided", async () => {
    const out = await render(<Progress aria-label="Direct label" />);
    expect(out).toContain('aria-label="Direct label"');
  });

  it("prefers explicit aria-label over label prop", async () => {
    const out = await render(<Progress aria-label="Explicit" label="Ignored" />);
    expect(out).toContain('aria-label="Explicit"');
    expect(out).not.toContain("Ignored");
  });

  it("includes base styling classes", async () => {
    const out = await render(<Progress />);
    expect(out).toContain("h-2");
    expect(out).toContain("w-full");
    expect(out).toContain("rounded-full");
  });

  it("merges a custom class", async () => {
    const out = await render(<Progress class="my-progress" />);
    expect(out).toContain("my-progress");
    expect(out).toContain("rounded-full");
  });
});
