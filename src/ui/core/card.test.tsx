import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { html } from "hono/html";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

async function render(element: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(html`${element}`));
  const res = await app.request("/");
  return res.text();
}

describe("Card", () => {
  it("renders root card classes", async () => {
    const out = await render(<Card>content</Card>);
    expect(out).toContain('data-slot="card"');
    expect(out).toContain("rounded-2xl");
    expect(out).toContain("border-brand-200");
    expect(out).toContain("bg-brand-100");
  });

  it("renders CardHeader with title, description, and action slots", async () => {
    const out = await render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
          <CardAction>Action</CardAction>
        </CardHeader>
      </Card>,
    );
    expect(out).toContain("Title");
    expect(out).toContain('data-slot="card-header"');
    expect(out).toContain('data-slot="card-title"');
    expect(out).toContain('data-slot="card-description"');
    expect(out).toContain('data-slot="card-action"');
  });

  it("renders CardContent with padding", async () => {
    const out = await render(
      <Card>
        <CardContent>Body</CardContent>
      </Card>,
    );
    expect(out).toContain("Body");
    expect(out).toContain('data-slot="card-content"');
    expect(out).toContain("px-6");
    expect(out).toContain("py-5");
  });

  it("renders CardFooter with border-t and padding", async () => {
    const out = await render(
      <Card>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );
    expect(out).toContain("Footer");
    expect(out).toContain('data-slot="card-footer"');
    expect(out).toContain("border-t");
    expect(out).toContain("px-6");
  });

  it("renders all sub-components in document order", async () => {
    const out = await render(
      <Card>
        <CardHeader>Head</CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Foot</CardFooter>
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
