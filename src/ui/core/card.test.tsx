import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Card } from "./card";
import { attrsOf, classesOf } from "./test-support";

const slotsOf = (html: string) => [...html.matchAll(/data-slot="([^"]*)"/g)].map((match) => match[1]);
const textNodes = (html: string) => html.split(/<[^>]+>/).filter(Boolean);

describe("Card", () => {
  it("renders the whole surface exactly, forwarded attributes escaped", async () => {
    expect(
      await render(
        <Card id='c1' data-testid='card' data-note={`R&D's <x>`}>
          content
        </Card>,
      ),
    ).toBe(
      '<div data-slot="card" class="flex flex-col rounded-box border border-border bg-card text-card-foreground shadow-sm" id="c1"' +
        ' data-testid="card" data-note="R&amp;D&#39;s &lt;x&gt;">content</div>',
    );
  });

  it("wraps its children in one slotted surface and nothing else", async () => {
    const html = await render(<Card>content</Card>);

    expect(attrsOf(html)).toEqual({ "data-slot": "card" });
    expect(textNodes(html)).toEqual(["content"]);
  });

  it("keeps the description under the title and leaves the header's second track to the action", async () => {
    const html = await render(
      <Card>
        <Card.Header>
          <Card.Title>Title</Card.Title>
          <Card.Description>Description</Card.Description>
          <Card.Action>Action</Card.Action>
        </Card.Header>
      </Card>,
    );

    expect(slotsOf(html)).toEqual(["card", "card-header", "card-title", "card-description", "card-action"]);
    expect(textNodes(html)).toEqual(["Title", "Description", "Action"]);
    expect(
      ["card-title", "card-description", "card-action"].map((slot) =>
        classesOf(html, `data-slot="${slot}"`).filter((token) => token.startsWith("col-start-")),
      ),
    ).toEqual([["col-start-1"], ["col-start-1"], ["col-start-2"]]);
  });

  it("renders header, content and footer as siblings in document order", async () => {
    const html = await render(
      <Card>
        <Card.Header>Head</Card.Header>
        <Card.Content>Body</Card.Content>
        <Card.Footer>Foot</Card.Footer>
      </Card>,
    );

    expect(slotsOf(html)).toEqual(["card", "card-header", "card-content", "card-footer"]);
    expect(textNodes(html)).toEqual(["Head", "Body", "Foot"]);
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Card class='extra'>content</Card>)).at(-1)).toBe("extra");
  });

  it("forwards id and aria-* attributes onto a sub-part rather than onto the surface", async () => {
    expect(
      attrsOf(
        await render(
          <Card.Header id='h1' aria-label='header region'>
            head
          </Card.Header>,
        ),
      ),
    ).toEqual({ "data-slot": "card-header", id: "h1", "aria-label": "header region" });
  });
});
