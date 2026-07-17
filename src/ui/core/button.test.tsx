import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Button } from "./button";

const BASE =
  "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

describe("Button", () => {
  it("renders with primary variant classes by default", async () => {
    expect(await render(<Button>Click</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BASE} bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 text-sm">Click</button>`,
    );
  });

  it("renders secondary variant classes", async () => {
    expect(await render(<Button variant='secondary'>Click</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BASE} border border-input text-foreground hover:bg-accent h-10 px-4 text-sm">Click</button>`,
    );
  });

  it("renders ghost variant classes without primary background", async () => {
    expect(await render(<Button variant='ghost'>Click</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BASE} text-foreground hover:bg-accent h-10 px-4 text-sm">Click</button>`,
    );
  });

  it("renders sm size classes", async () => {
    expect(await render(<Button size='sm'>Click</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BASE} bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3 text-sm">Click</button>`,
    );
  });

  it("renders md size classes by default", async () => {
    expect(await render(<Button>Click</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BASE} bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 text-sm">Click</button>`,
    );
  });

  it("renders lg size classes", async () => {
    expect(await render(<Button size='lg'>Click</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BASE} bg-primary text-primary-foreground hover:bg-primary/90 h-12 px-6 text-base">Click</button>`,
    );
  });

  it("renders icon size classes", async () => {
    expect(await render(<Button size='icon'>Click</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BASE} bg-primary text-primary-foreground hover:bg-primary/90 size-9 p-0">Click</button>`,
    );
  });

  it("renders icon-sm size classes", async () => {
    expect(await render(<Button size='icon-sm'>Click</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BASE} bg-primary text-primary-foreground hover:bg-primary/90 size-[34px] p-0">Click</button>`,
    );
  });

  it("defaults to type=button", async () => {
    expect(await render(<Button>Click</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BASE} bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 text-sm">Click</button>`,
    );
  });

  it("sets type=submit when specified", async () => {
    expect(await render(<Button type='submit'>Click</Button>)).toBe(
      `<button type="submit" data-slot="button" class="${BASE} bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 text-sm">Click</button>`,
    );
  });

  it("passes the disabled attribute through", async () => {
    expect(await render(<Button disabled>Click</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BASE} bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 text-sm" disabled>Click</button>`,
    );
  });

  it("omits the disabled attribute when not set", async () => {
    expect(await render(<Button>Click</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BASE} bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 text-sm">Click</button>`,
    );
  });

  it("passes through the data-ref attribute", async () => {
    expect(await render(<Button data-ref='my-btn'>Click</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BASE} bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 text-sm" data-ref="my-btn">Click</button>`,
    );
  });

  it("merges a custom class with the variant classes", async () => {
    expect(await render(<Button class='extra-class'>Click</Button>)).toBe(
      `<button type="button" data-slot="button" class="${BASE} bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 text-sm extra-class">Click</button>`,
    );
  });

  it("supports asChild for a single element child", async () => {
    expect(
      await render(
        <Button asChild>
          <a href='/contact'>Contact</a>
        </Button>,
      ),
    ).toBe(
      `<a href="/contact" class="${BASE} bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 text-sm" data-slot="button">Contact</a>`,
    );
  });

  it("throws when asChild is given a non-element child", async () => {
    await expect(render(<Button asChild>just text</Button>)).rejects.toThrow("Button with asChild requires exactly one JSX element child");
  });

  it("forwards arbitrary data-* attributes with HTML-escaped values", async () => {
    expect(
      await render(
        <Button data-test-hook='cta' data-note='a&b'>
          Go
        </Button>,
      ),
    ).toBe(
      `<button type="button" data-slot="button" class="${BASE} bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 text-sm" data-test-hook="cta" data-note="a&amp;b">Go</button>`,
    );
  });
});
