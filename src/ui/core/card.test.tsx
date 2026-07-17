import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Card } from "./card";

describe("Card", () => {
  it("renders root card classes", async () => {
    expect(await render(<Card>content</Card>)).toBe(
      '<div data-slot="card" class="flex flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-sm">content</div>',
    );
  });

  it("renders Card.Header with title, description, and action slots", async () => {
    expect(
      await render(
        <Card>
          <Card.Header>
            <Card.Title>Title</Card.Title>
            <Card.Description>Description</Card.Description>
            <Card.Action>Action</Card.Action>
          </Card.Header>
        </Card>,
      ),
    ).toBe(
      '<div data-slot="card" class="flex flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-sm"><div data-slot="card-header" class="grid auto-rows-min grid-cols-[1fr_auto] items-start gap-1.5 border-b border-border px-6 py-5"><div data-slot="card-title" class="font-semibold leading-none text-card-foreground">Title</div><div data-slot="card-description" class="text-sm text-muted-foreground">Description</div><div data-slot="card-action" class="col-start-2 row-span-2 row-start-1 self-start justify-self-end">Action</div></div></div>',
    );
  });

  it("renders Card.Content with padding", async () => {
    expect(
      await render(
        <Card>
          <Card.Content>Body</Card.Content>
        </Card>,
      ),
    ).toBe(
      '<div data-slot="card" class="flex flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-sm"><div data-slot="card-content" class="px-6 py-5">Body</div></div>',
    );
  });

  it("renders Card.Footer with border-t and padding", async () => {
    expect(
      await render(
        <Card>
          <Card.Footer>Footer</Card.Footer>
        </Card>,
      ),
    ).toBe(
      '<div data-slot="card" class="flex flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-sm"><div data-slot="card-footer" class="flex items-center gap-2 border-t border-border px-6 py-4">Footer</div></div>',
    );
  });

  it("renders all sub-components in document order", async () => {
    expect(
      await render(
        <Card>
          <Card.Header>Head</Card.Header>
          <Card.Content>Body</Card.Content>
          <Card.Footer>Foot</Card.Footer>
        </Card>,
      ),
    ).toBe(
      '<div data-slot="card" class="flex flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-sm"><div data-slot="card-header" class="grid auto-rows-min grid-cols-[1fr_auto] items-start gap-1.5 border-b border-border px-6 py-5">Head</div><div data-slot="card-content" class="px-6 py-5">Body</div><div data-slot="card-footer" class="flex items-center gap-2 border-t border-border px-6 py-4">Foot</div></div>',
    );
  });

  it("merges a custom class on the root element", async () => {
    expect(await render(<Card class='extra'>content</Card>)).toBe(
      '<div data-slot="card" class="flex flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-sm extra">content</div>',
    );
  });

  it("forwards id and data-* attributes on the root with HTML-escaped values", async () => {
    expect(
      await render(
        <Card id='c1' data-testid='card' data-note='a&b'>
          content
        </Card>,
      ),
    ).toBe(
      '<div data-slot="card" class="flex flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-sm" id="c1" data-testid="card" data-note="a&amp;b">content</div>',
    );
  });

  it("forwards id and aria-* attributes on sub-parts", async () => {
    expect(
      await render(
        <Card.Header id='h1' aria-label='header region'>
          head
        </Card.Header>,
      ),
    ).toBe(
      '<div data-slot="card-header" class="grid auto-rows-min grid-cols-[1fr_auto] items-start gap-1.5 border-b border-border px-6 py-5" id="h1" aria-label="header region">head</div>',
    );
  });
});
