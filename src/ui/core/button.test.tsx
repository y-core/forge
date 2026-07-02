import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Button } from "./button";

describe("Button", () => {
  it("renders with primary variant classes by default", async () => {
    const out = await render(<Button>Click</Button>);
    expect(out).toContain('data-slot="button"');
    expect(out).toContain("bg-primary");
    expect(out).toContain("text-primary-foreground");
  });

  it("renders secondary variant classes", async () => {
    const out = await render(<Button variant='secondary'>Click</Button>);
    expect(out).toContain("border-input");
    expect(out).toContain("text-foreground");
  });

  it("renders ghost variant classes without primary background", async () => {
    const out = await render(<Button variant='ghost'>Click</Button>);
    expect(out).toContain("hover:bg-accent");
    expect(out).not.toContain("bg-primary");
  });

  it("renders sm size classes", async () => {
    const out = await render(<Button size='sm'>Click</Button>);
    expect(out).toContain("h-8");
    expect(out).toContain("px-3");
  });

  it("renders md size classes by default", async () => {
    const out = await render(<Button>Click</Button>);
    expect(out).toContain("h-10");
    expect(out).toContain("px-4");
  });

  it("renders lg size classes", async () => {
    const out = await render(<Button size='lg'>Click</Button>);
    expect(out).toContain("h-12");
    expect(out).toContain("px-6");
  });

  it("renders icon size classes", async () => {
    const out = await render(<Button size='icon'>Click</Button>);
    expect(out).toContain("size-9");
    expect(out).toContain("p-0");
    expect(out).not.toContain("px-");
  });

  it("renders icon-sm size classes", async () => {
    const out = await render(<Button size='icon-sm'>Click</Button>);
    expect(out).toContain("size-[34px]");
    expect(out).toContain("p-0");
  });

  it("defaults to type=button", async () => {
    const out = await render(<Button>Click</Button>);
    expect(out).toContain('type="button"');
  });

  it("sets type=submit when specified", async () => {
    const out = await render(<Button type='submit'>Click</Button>);
    expect(out).toContain('type="submit"');
  });

  it("passes the disabled attribute through", async () => {
    const withDisabled = await render(<Button disabled>Click</Button>);
    const withoutDisabled = await render(<Button>Click</Button>);
    expect(withDisabled).toMatch(/\bdisabled(?!:)/);
    expect(withoutDisabled).not.toMatch(/\bdisabled(?!:)/);
  });

  it("passes through the data-ref attribute", async () => {
    const out = await render(<Button data-ref='my-btn'>Click</Button>);
    expect(out).toContain('data-ref="my-btn"');
  });

  it("merges a custom class with the variant classes", async () => {
    const out = await render(<Button class='extra-class'>Click</Button>);
    expect(out).toContain("extra-class");
    expect(out).toContain("inline-flex");
  });

  it("supports asChild for a single element child", async () => {
    const out = await render(
      <Button asChild>
        <a href='/contact'>Contact</a>
      </Button>,
    );
    expect(out).toContain("<a");
    expect(out).toContain('href="/contact"');
    expect(out).toContain('data-slot="button"');
    expect(out).toContain("inline-flex");
  });

  it("forwards arbitrary data-* attributes with HTML-escaped values", async () => {
    const out = await render(
      <Button data-test-hook='cta' data-note='a&b'>
        Go
      </Button>,
    );
    expect(out).toContain('data-test-hook="cta"');
    expect(out).toContain('data-note="a&amp;b"');
  });
});
