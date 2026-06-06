/** @jsxImportSource @y-core/forge */
import { describe, expect, it } from "bun:test";
import { renderToString } from "../../jsx/render-to-string";
import { Textarea } from "./textarea";

async function render(element: unknown): Promise<string> {
  return String(await renderToString(element));
}

describe("Textarea", () => {
  it("renders a <textarea> element", async () => {
    const out = await render(<Textarea />);
    expect(out).toContain("<textarea");
    expect(out).toContain('data-slot="textarea"');
  });

  it("includes default styling classes including resize-y", async () => {
    const out = await render(<Textarea />);
    expect(out).toContain("w-full");
    expect(out).toContain("rounded-lg");
    expect(out).toContain("resize-y");
  });

  it("renders children as textarea content", async () => {
    const out = await render(<Textarea>Initial text</Textarea>);
    expect(out).toContain("Initial text");
  });

  it("passes through id, name, and rows", async () => {
    const out = await render(<Textarea id='msg' name='message' rows={5} />);
    expect(out).toContain('id="msg"');
    expect(out).toContain('name="message"');
    expect(out).toContain('rows="5"');
  });

  it("passes through the placeholder attribute", async () => {
    const out = await render(<Textarea placeholder='Your message' />);
    expect(out).toContain('placeholder="Your message"');
  });

  it("passes through required and disabled", async () => {
    const withBoth = await render(<Textarea required disabled />);
    expect(withBoth).toContain("required");
    expect(withBoth).toMatch(/\bdisabled(?!:)/);
  });

  it("passes through aria-describedby and aria-invalid", async () => {
    const out = await render(<Textarea aria-describedby='desc' aria-invalid='true' />);
    expect(out).toContain('aria-describedby="desc"');
    expect(out).toContain('aria-invalid="true"');
  });

  it("merges a custom class with the default classes", async () => {
    const out = await render(<Textarea class='extra'>text</Textarea>);
    expect(out).toContain("extra");
    expect(out).toContain("resize-y");
  });
});
