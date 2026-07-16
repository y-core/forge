import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Card } from "./card";

describe("Card", () => {
  it("renders root card classes", async () => {
    const out = await render(<Card>content</Card>);
    expect(out).toContain('data-slot="card"');
    expect(out).toContain("rounded-2xl");
    expect(out).toContain("border-border");
    expect(out).toContain("bg-card");
  });

  it("renders Card.Header with title, description, and action slots", async () => {
    const out = await render(
      <Card>
        <Card.Header>
          <Card.Title>Title</Card.Title>
          <Card.Description>Description</Card.Description>
          <Card.Action>Action</Card.Action>
        </Card.Header>
      </Card>,
    );
    expect(out).toContain("Title");
    expect(out).toContain('data-slot="card-header"');
    expect(out).toContain('data-slot="card-title"');
    expect(out).toContain('data-slot="card-description"');
    expect(out).toContain('data-slot="card-action"');
  });

  it("renders Card.Content with padding", async () => {
    const out = await render(
      <Card>
        <Card.Content>Body</Card.Content>
      </Card>,
    );
    expect(out).toContain("Body");
    expect(out).toContain('data-slot="card-content"');
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
    expect(out).toContain('data-slot="card-footer"');
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
    const out = await render(<Card class='extra'>content</Card>);
    expect(out).toContain("extra");
    expect(out).toContain("rounded-2xl");
  });

  it("forwards id and data-* attributes on the root with HTML-escaped values", async () => {
    const out = await render(
      <Card id='c1' data-testid='card' data-note='a&b'>
        content
      </Card>,
    );
    expect(out).toContain('id="c1"');
    expect(out).toContain('data-testid="card"');
    expect(out).toContain('data-note="a&amp;b"');
    expect(out).toContain('data-slot="card"');
  });

  it("forwards id and aria-* attributes on sub-parts", async () => {
    const out = await render(
      <Card.Header id='h1' aria-label='header region'>
        head
      </Card.Header>,
    );
    expect(out).toContain('id="h1"');
    expect(out).toContain('aria-label="header region"');
    expect(out).toContain('data-slot="card-header"');
  });
});
