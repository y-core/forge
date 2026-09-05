import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("renders a <textarea> element", async () => {
    expect(await render(<Textarea />)).toBe(
      '<textarea data-slot="textarea" data-size="md" class="state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-sm"></textarea>',
    );
  });

  it("includes default styling classes including resize-y", async () => {
    expect(await render(<Textarea />)).toBe(
      '<textarea data-slot="textarea" data-size="md" class="state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-sm"></textarea>',
    );
  });

  it("renders children as textarea content", async () => {
    expect(await render(<Textarea>Initial text</Textarea>)).toBe(
      '<textarea data-slot="textarea" data-size="md" class="state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-sm">Initial text</textarea>',
    );
  });

  it("passes through id, name, and rows", async () => {
    expect(await render(<Textarea id='msg' name='message' rows={5} />)).toBe(
      '<textarea data-slot="textarea" data-size="md" class="state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-sm" id="msg" name="message" rows="5"></textarea>',
    );
  });

  it("passes through the placeholder attribute", async () => {
    expect(await render(<Textarea placeholder='Your message' />)).toBe(
      '<textarea data-slot="textarea" data-size="md" class="state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-sm" placeholder="Your message"></textarea>',
    );
  });

  it("passes through required and disabled", async () => {
    expect(await render(<Textarea required disabled />)).toBe(
      '<textarea data-slot="textarea" data-size="md" class="state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-sm" required disabled></textarea>',
    );
  });

  it("passes through aria-describedby and aria-invalid", async () => {
    expect(await render(<Textarea aria-describedby='desc' aria-invalid='true' />)).toBe(
      '<textarea data-slot="textarea" data-size="md" class="state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-sm" aria-describedby="desc" aria-invalid="true"></textarea>',
    );
  });

  it("merges a custom class with the default classes", async () => {
    expect(await render(<Textarea class='extra'>text</Textarea>)).toBe(
      '<textarea data-slot="textarea" data-size="md" class="state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-sm extra">text</textarea>',
    );
  });
});

describe("Textarea — size, invalid and busy", () => {
  it("stamps data-size=md and the md type size by default", async () => {
    expect(await render(<Textarea />)).toBe(
      '<textarea data-slot="textarea" data-size="md" class="state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-sm"></textarea>',
    );
  });

  it("size='sm' keeps the small type size", async () => {
    expect(await render(<Textarea size='sm' />)).toBe(
      '<textarea data-slot="textarea" data-size="sm" class="state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-sm"></textarea>',
    );
  });

  it("size='lg' steps the type size up", async () => {
    expect(await render(<Textarea size='lg' />)).toBe(
      '<textarea data-slot="textarea" data-size="lg" class="state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-base"></textarea>',
    );
  });

  it("invalid stamps data-invalid beside aria-invalid", async () => {
    expect(await render(<Textarea invalid />)).toBe(
      '<textarea data-slot="textarea" data-size="md" class="state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-sm" data-invalid="" aria-invalid="true"></textarea>',
    );
  });

  it("busy stamps data-busy beside aria-busy", async () => {
    expect(await render(<Textarea busy />)).toBe(
      '<textarea data-slot="textarea" data-size="md" class="state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-sm" data-busy="" aria-busy="true"></textarea>',
    );
  });

  // `state-invalid` sets `border-color` *and* `--tw-ring-color`, so before it had a group key of
  // its own it shared `ring-*`'s slot and a caller's ring silently deleted it — leaving a control
  // that announced `aria-invalid` while looking valid.
  it("keeps state-invalid when the caller supplies a ring of their own", async () => {
    expect(await render(<Textarea class='ring-primary' />)).toBe(
      '<textarea data-slot="textarea" data-size="md" class="state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-sm ring-primary"></textarea>',
    );
  });
});
