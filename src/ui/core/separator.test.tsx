import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Separator } from "./separator";

describe("Separator", () => {
  it("renders an <hr> element", async () => {
    const out = await render(<Separator />);
    expect(out).toContain("<hr");
  });

  it("defaults to horizontal with h-px and w-full classes", async () => {
    const out = await render(<Separator />);
    expect(out).toContain("h-px");
    expect(out).toContain("w-full");
  });

  it("renders vertical classes when orientation=vertical", async () => {
    const out = await render(<Separator orientation='vertical' />);
    expect(out).toContain("h-full");
    expect(out).toContain("w-px");
  });

  it("sets aria-orientation=horizontal by default", async () => {
    const out = await render(<Separator />);
    expect(out).toContain('aria-orientation="horizontal"');
  });

  it("sets aria-orientation=vertical when specified", async () => {
    const out = await render(<Separator orientation='vertical' />);
    expect(out).toContain('aria-orientation="vertical"');
  });

  it("merges a custom class with the base classes", async () => {
    const out = await render(<Separator class='my-sep' />);
    expect(out).toContain("my-sep");
    expect(out).toContain("border-0");
  });
});
