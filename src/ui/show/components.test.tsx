/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { ShowcaseContent } from "./components";
import { showcasePaths } from "./route";

// Minimal icon compatible with ForgeIcon<…>; renders nothing.
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const StubIcon = ((_props: any) => null) as any;
StubIcon.sprite = "/icons.svg";
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const icon = StubIcon as any;

describe("ShowcaseContent", () => {
  it("renders the showcase page shell without throwing", async () => {
    const out = await render(<ShowcaseContent data={{ paths: showcasePaths("/showcase") }} icon={icon} />);
    expect(out).toContain('id="main-content"');
    expect(out).toContain("UI Component Showcase");
  });

  it("includes the static catalog, HTMX demos, theme and resumable sections", async () => {
    const out = await render(<ShowcaseContent data={{ paths: showcasePaths("/showcase") }} icon={icon} />);
    expect(out).toContain('id="button"');
    expect(out).toContain('id="htmx-demos"');
    expect(out).toContain('id="theme"');
    expect(out).toContain('data-scope="show-filter"');
    // OOB flash sink present so demo toasts have a target.
    expect(out).toContain('id="flash-container"');
  });
});
