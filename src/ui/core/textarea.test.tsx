import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("renders a <textarea> element", async () => {
    expect(await render(<Textarea />)).toBe(
      '<textarea data-slot="textarea" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 resize-y"></textarea>',
    );
  });

  it("includes default styling classes including resize-y", async () => {
    expect(await render(<Textarea />)).toBe(
      '<textarea data-slot="textarea" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 resize-y"></textarea>',
    );
  });

  it("renders children as textarea content", async () => {
    expect(await render(<Textarea>Initial text</Textarea>)).toBe(
      '<textarea data-slot="textarea" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 resize-y">Initial text</textarea>',
    );
  });

  it("passes through id, name, and rows", async () => {
    expect(await render(<Textarea id='msg' name='message' rows={5} />)).toBe(
      '<textarea data-slot="textarea" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 resize-y" id="msg" name="message" rows="5"></textarea>',
    );
  });

  it("passes through the placeholder attribute", async () => {
    expect(await render(<Textarea placeholder='Your message' />)).toBe(
      '<textarea data-slot="textarea" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 resize-y" placeholder="Your message"></textarea>',
    );
  });

  it("passes through required and disabled", async () => {
    expect(await render(<Textarea required disabled />)).toBe(
      '<textarea data-slot="textarea" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 resize-y" required disabled></textarea>',
    );
  });

  it("passes through aria-describedby and aria-invalid", async () => {
    expect(await render(<Textarea aria-describedby='desc' aria-invalid='true' />)).toBe(
      '<textarea data-slot="textarea" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 resize-y" aria-describedby="desc" aria-invalid="true"></textarea>',
    );
  });

  it("merges a custom class with the default classes", async () => {
    expect(await render(<Textarea class='extra'>text</Textarea>)).toBe(
      '<textarea data-slot="textarea" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 resize-y extra">text</textarea>',
    );
  });
});
