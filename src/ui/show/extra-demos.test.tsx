/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { ShowcaseContent, type ShowcasePage } from "./components";
import { sectionBodies } from "./coverage";
import { LAZY_DEMO_LOADED, LAZY_DEMO_PENDING, LAZY_DEMO_REF, LAZY_DEMO_SCOPE } from "./lazy-contract";
import { showcasePaths } from "./route";

// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const StubIcon = ((_props: any) => null) as any;
StubIcon.sprite = "/icons.svg";
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const icon = StubIcon as any;

const page = (which: ShowcasePage) => render(<ShowcaseContent data={{ paths: showcasePaths("/showcase") }} icon={icon} page={which} />);

// Cut at the close tag: `sectionBodies` slices to the next section, so the last section on a page
// would otherwise swallow the shared FlashContainer that follows the body.
const bodyOf = async (which: ShowcasePage, id: string) => {
  const body = sectionBodies(await page(which)).get(id) ?? "";
  const end = body.indexOf("</section>");
  return end === -1 ? body : body.slice(0, end);
};

const attrOf = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

const occurrences = (html: string, needle: string) => html.split(needle).length - 1;

describe("FlashSection", () => {
  it("points the flash trigger at the toast endpoint as an out-of-band swap", async () => {
    const body = await bodyOf("htmx", "flash");
    const trigger = [...body.matchAll(/<button[^>]*>/g)].map((match) => match[0]).find((tag) => attrOf(tag, "hx-get") !== null);
    expect(trigger).toBeDefined();
    expect([attrOf(trigger ?? "", "hx-get"), attrOf(trigger ?? "", "hx-swap")]).toEqual(["/showcase/toast?type=info", "none"]);
  });

  it("shows every severity Flash can emit, rather than describing them in prose", async () => {
    const body = await bodyOf("htmx", "flash");
    const variants = [...body.matchAll(/data-slot="toast" data-variant="([^"]*)"/g)].map((match) => match[1]);
    expect(variants).toEqual(["success", "info", "warning", "destructive", "info"]);
  });

  it("adds no second live region and no second container, which is the invariant that matters", async () => {
    const body = await bodyOf("htmx", "flash");
    expect([...body.matchAll(/aria-live="[^"]*"/g)].map((match) => match[0])).toEqual([]);
    expect(occurrences(body, 'data-slot="toast-container"')).toBe(0);
  });

  it("renders the out-of-band wrapper hidden, since it is an instruction and not page content", async () => {
    const body = await bodyOf("htmx", "flash");
    expect(/<div hidden><div hx-swap-oob="beforeend:#flash-container">/.test(body)).toBe(true);
  });
});

describe("LazySection", () => {
  it("stamps the lazy scope around the panel", async () => {
    const out = await page("runtime");
    const body = sectionBodies(out).get("lazy") ?? "";
    expect(body.match(new RegExp(`<div data-scope="${LAZY_DEMO_SCOPE}"[^>]*>`))?.[0]).toBe('<div data-scope="show-lazy" class="w-full space-y-3">');
    expect(occurrences(out, `data-ref="${LAZY_DEMO_REF}"`)).toBe(1);
  });

  it("renders the pending line and never the loaded line", async () => {
    const body = await bodyOf("runtime", "lazy");
    expect([occurrences(body, LAZY_DEMO_PENDING), occurrences(body, LAZY_DEMO_LOADED)]).toEqual([1, 0]);
  });
});
