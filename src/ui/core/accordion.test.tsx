/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Accordion } from "./accordion";
import { createIcon } from "./icon";

const icon = createIcon("/sprite.svg");

describe("Accordion", () => {
  it("renders the root with data-slot=accordion", async () => {
    const out = await render(<Accordion>content</Accordion>);
    expect(out).toContain('data-slot="accordion"');
    expect(out).toContain("flex flex-col");
  });

  it("merges a custom class on the root", async () => {
    const out = await render(<Accordion class='my-accordion'>content</Accordion>);
    expect(out).toContain("my-accordion");
    expect(out).toContain("flex flex-col");
  });

  it("forwards id and data-* attributes on the root with HTML-escaped values", async () => {
    const out = await render(
      <Accordion id='acc1' data-testid='accordion' data-note='a&b'>
        content
      </Accordion>,
    );
    expect(out).toContain('id="acc1"');
    expect(out).toContain('data-testid="accordion"');
    expect(out).toContain('data-note="a&amp;b"');
    expect(out).toContain('data-slot="accordion"');
  });

  it("forwards id and data-* attributes on the trigger summary", async () => {
    const out = await render(
      <Accordion.Trigger icon={icon} id='trg1' data-testid='trigger'>
        Section
      </Accordion.Trigger>,
    );
    expect(out).toContain("<summary");
    expect(out).toContain('id="trg1"');
    expect(out).toContain('data-testid="trigger"');
    expect(out).toContain('data-slot="accordion-trigger"');
    expect(out).toContain("Section");
  });

  it("forwards id and data-* attributes on the content", async () => {
    const out = await render(
      <Accordion.Content id='cnt1' data-note='a&b'>
        Body
      </Accordion.Content>,
    );
    expect(out).toContain('id="cnt1"');
    expect(out).toContain('data-note="a&amp;b"');
    expect(out).toContain('data-slot="accordion-content"');
    expect(out).toContain("Body");
  });
});
