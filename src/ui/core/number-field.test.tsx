import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { NUMBER_FIELD_SCOPE } from "../contracts/number-field-contract";
import { NumberField } from "./number-field";

describe("NumberField", () => {
  it("renders the root row with the scope the controller resumes on", async () => {
    expect(await render(<NumberField />)).toBe(
      `<div data-slot="number-field" data-scope="${NUMBER_FIELD_SCOPE}" class="inline-flex items-center gap-1"></div>`,
    );
  });

  it("merges a caller class onto the root base", async () => {
    expect(await render(<NumberField class='w-full' />)).toBe(
      '<div data-slot="number-field" data-scope="number-field" class="inline-flex items-center gap-1 w-full"></div>',
    );
  });

  it("keeps its own slot token ahead of one handed down through props", async () => {
    expect(await render(<NumberField data-slot='quantity' />)).toBe(
      '<div data-slot="number-field quantity" data-scope="number-field" class="inline-flex items-center gap-1"></div>',
    );
  });

  it("escapes arbitrary data-* and aria-* values spread onto the root", async () => {
    expect(await render(<NumberField data-note={`R&D's "count" <n>`} aria-label={`R&D's count`} />)).toBe(
      '<div data-slot="number-field" data-scope="number-field" class="inline-flex items-center gap-1" data-note="R&amp;D&#39;s &quot;count&quot; &lt;n&gt;" aria-label="R&amp;D&#39;s count"></div>',
    );
  });

  it("keeps aria-readonly off the steppers even when the input beside them is readonly", async () => {
    expect(
      await render(
        <NumberField>
          <NumberField.Decrement />
          <NumberField.Input name='count' value='1' readonly />
          <NumberField.Increment />
        </NumberField>,
      ),
    ).toBe(
      '<div data-slot="number-field" data-scope="number-field" class="inline-flex items-center gap-1"><button type="button" data-slot="number-field-decrement" aria-label="Decrement" class="inline-flex size-8 items-center justify-center rounded-field border border-input bg-background cursor-pointer text-foreground focus-ring hover:bg-accent state-disabled">\u2212</button><input type="number" data-slot="number-field-input" data-size="md" class="state-busy state-disabled field-chrome w-20 text-end tabular-nums focus-ring state-invalid h-control-md text-sm" name="count" value="1" readonly><button type="button" data-slot="number-field-increment" aria-label="Increment" class="inline-flex size-8 items-center justify-center rounded-field border border-input bg-background cursor-pointer text-foreground focus-ring hover:bg-accent state-disabled">+</button></div>',
    );
  });

  it("renders the whole compound in one tree", async () => {
    expect(
      await render(
        <NumberField>
          <NumberField.Decrement />
          <NumberField.Input name='count' value='1' min='0' max='10' />
          <NumberField.Increment />
        </NumberField>,
      ),
    ).toBe(
      '<div data-slot="number-field" data-scope="number-field" class="inline-flex items-center gap-1"><button type="button" data-slot="number-field-decrement" aria-label="Decrement" class="inline-flex size-8 items-center justify-center rounded-field border border-input bg-background cursor-pointer text-foreground focus-ring hover:bg-accent state-disabled">\u2212</button><input type="number" data-slot="number-field-input" data-size="md" class="state-busy state-disabled field-chrome w-20 text-end tabular-nums focus-ring state-invalid h-control-md text-sm" name="count" value="1" min="0" max="10"><button type="button" data-slot="number-field-increment" aria-label="Increment" class="inline-flex size-8 items-center justify-center rounded-field border border-input bg-background cursor-pointer text-foreground focus-ring hover:bg-accent state-disabled">+</button></div>',
    );
  });
});

describe("NumberField.Input", () => {
  it("renders a native number input and nothing more", async () => {
    expect(await render(<NumberField.Input />)).toBe(
      '<input type="number" data-slot="number-field-input" data-size="md" class="state-busy state-disabled field-chrome w-20 text-end tabular-nums focus-ring state-invalid h-control-md text-sm">',
    );
  });

  it("passes the platform's own range attributes straight through", async () => {
    expect(await render(<NumberField.Input name='count' value='3' min='0' max='10' step='2' required />)).toBe(
      '<input type="number" data-slot="number-field-input" data-size="md" class="state-busy state-disabled field-chrome w-20 text-end tabular-nums focus-ring state-invalid h-control-md text-sm" name="count" value="3" min="0" max="10" step="2" required>',
    );
  });

  it("merges a caller class and appends an inherited slot token", async () => {
    expect(await render(<NumberField.Input class='w-32' data-slot='quantity-input' />)).toBe(
      '<input type="number" data-slot="number-field-input quantity-input" data-size="md" class="state-busy state-disabled field-chrome text-end tabular-nums focus-ring state-invalid h-control-md text-sm w-32">',
    );
  });
});

describe("NumberField.Decrement", () => {
  it("defaults to a minus-sign glyph behind an explicit label", async () => {
    expect(await render(<NumberField.Decrement />)).toBe(
      '<button type="button" data-slot="number-field-decrement" aria-label="Decrement" class="inline-flex size-8 items-center justify-center rounded-field border border-input bg-background cursor-pointer text-foreground focus-ring hover:bg-accent state-disabled">\u2212</button>',
    );
  });

  it("takes caller children in place of the glyph, and passes disabled through", async () => {
    expect(await render(<NumberField.Decrement disabled>Less</NumberField.Decrement>)).toBe(
      '<button type="button" data-slot="number-field-decrement" aria-label="Decrement" class="inline-flex size-8 items-center justify-center rounded-field border border-input bg-background cursor-pointer text-foreground focus-ring hover:bg-accent state-disabled" disabled>Less</button>',
    );
  });

  it("lets a caller replace the default label in place, and override the conflicting size utility", async () => {
    expect(await render(<NumberField.Decrement aria-label={`Fewer R&D's`} class='size-6' data-slot='quantity-down' />)).toBe(
      '<button type="button" data-slot="number-field-decrement quantity-down" aria-label="Fewer R&amp;D&#39;s" class="inline-flex items-center justify-center rounded-field border border-input bg-background cursor-pointer text-foreground focus-ring hover:bg-accent state-disabled size-6">\u2212</button>',
    );
  });
});

describe("NumberField.Increment", () => {
  it("defaults to a plus glyph behind an explicit label", async () => {
    expect(await render(<NumberField.Increment />)).toBe(
      '<button type="button" data-slot="number-field-increment" aria-label="Increment" class="inline-flex size-8 items-center justify-center rounded-field border border-input bg-background cursor-pointer text-foreground focus-ring hover:bg-accent state-disabled">+</button>',
    );
  });

  it("takes caller children in place of the glyph and escapes them", async () => {
    expect(await render(<NumberField.Increment>{`R&D's <up>`}</NumberField.Increment>)).toBe(
      '<button type="button" data-slot="number-field-increment" aria-label="Increment" class="inline-flex size-8 items-center justify-center rounded-field border border-input bg-background cursor-pointer text-foreground focus-ring hover:bg-accent state-disabled">R&amp;D&#39;s &lt;up&gt;</button>',
    );
  });
});

describe("NumberField.Input — size, invalid and busy", () => {
  it("stamps data-size=md and the md field size by default", async () => {
    expect(await render(<NumberField.Input />)).toBe(
      '<input type="number" data-slot="number-field-input" data-size="md" class="state-busy state-disabled field-chrome w-20 text-end tabular-nums focus-ring state-invalid h-control-md text-sm">',
    );
  });

  it("size='sm' stamps data-size=sm and the sm field size", async () => {
    expect(await render(<NumberField.Input size='sm' />)).toBe(
      '<input type="number" data-slot="number-field-input" data-size="sm" class="state-busy state-disabled field-chrome w-20 text-end tabular-nums focus-ring state-invalid h-control-sm text-sm">',
    );
  });

  it("size='lg' stamps data-size=lg and the lg field size", async () => {
    expect(await render(<NumberField.Input size='lg' />)).toBe(
      '<input type="number" data-slot="number-field-input" data-size="lg" class="state-busy state-disabled field-chrome w-20 text-end tabular-nums focus-ring state-invalid h-control-lg text-base">',
    );
  });

  it("invalid stamps data-invalid beside aria-invalid", async () => {
    expect(await render(<NumberField.Input invalid />)).toBe(
      '<input type="number" data-slot="number-field-input" data-size="md" class="state-busy state-disabled field-chrome w-20 text-end tabular-nums focus-ring state-invalid h-control-md text-sm" data-invalid="" aria-invalid="true">',
    );
  });

  it("busy stamps data-busy beside aria-busy", async () => {
    expect(await render(<NumberField.Input busy />)).toBe(
      '<input type="number" data-slot="number-field-input" data-size="md" class="state-busy state-disabled field-chrome w-20 text-end tabular-nums focus-ring state-invalid h-control-md text-sm" data-busy="" aria-busy="true">',
    );
  });

  // `state-invalid` sets `border-color` *and* `--tw-ring-color`, so before it had a group key of
  // its own it shared `ring-*`'s slot and a caller's ring silently deleted it — leaving a control
  // that announced `aria-invalid` while looking valid.
  it("keeps state-invalid when the caller supplies a ring of their own", async () => {
    expect(await render(<NumberField.Input class='ring-primary' />)).toBe(
      '<input type="number" data-slot="number-field-input" data-size="md" class="state-busy state-disabled field-chrome w-20 text-end tabular-nums focus-ring state-invalid h-control-md text-sm ring-primary">',
    );
  });
});
