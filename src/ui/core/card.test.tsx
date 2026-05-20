import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { html } from "hono/html";
import { Card } from "./card";

async function render(element: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(html`${element}`));
  const res = await app.request("/");
  return res.text();
}

describe("Card", () => {
  it("renders root card classes", async () => {
    const out = await render(<Card>content</Card>);
    expect(out).toContain("rounded-2xl");
    expect(out).toContain("border-brand-200");
    expect(out).toContain("bg-brand-100");
  });

  it("renders Card.Header with border-b and padding", async () => {
    const out = await render(
      <Card>
        <Card.Header>Title</Card.Header>
      </Card>,
    );
    expect(out).toContain("Title");
    expect(out).toContain("border-b");
    expect(out).toContain("px-6");
    expect(out).toContain("py-5");
  });

  it("renders Card.Content with padding", async () => {
    const out = await render(
      <Card>
        <Card.Content>Body</Card.Content>
      </Card>,
    );
    expect(out).toContain("Body");
    expect(out).toContain("px-6");
    expect(out).toContain("py-5");
  });

  it("renders Card.Footer with border-t and padding", async () => {
    const out = await render(
      <Card>
        <Card.Footer>Footer</Card.Footer>
      </Card>,
    );
    expect(out).toContain("Footer");
    expect(out).toContain("border-t");
    expect(out).toContain("px-6");
  });

  it("renders all sub-components in document order", async () => {
    const out = await render(
      <Card>
        <Card.Header>Head</Card.Header>
        <Card.Content>Body</Card.Content>
        <Card.Footer>Foot</Card.Footer>
      </Card>,
    );
    expect(out.indexOf("Head")).toBeLessThan(out.indexOf("Body"));
    expect(out.indexOf("Body")).toBeLessThan(out.indexOf("Foot"));
  });

  it("merges a custom class on the root element", async () => {
    const out = await render(<Card class="extra">content</Card>);
    expect(out).toContain("extra");
    expect(out).toContain("rounded-2xl");
  });
});
