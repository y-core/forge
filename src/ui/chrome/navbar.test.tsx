/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { createIcon } from "../core/icon";
import { Navbar, type NavDefinition } from "./navbar";

/** Counts non-overlapping occurrences of `needle` in `haystack`. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const id = (key: string) => `/route/${key}`;

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16", "icon-hamburger": "0 0 22 22", "icon-close": "0 0 22 22" });

describe("Navbar — structure", () => {
  it("renders the root with data-slot=navbar inside a resumable scope", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toContain('data-slot="navbar"');
    expect(out).toContain('data-scope="navbar"');
    expect(out).toContain("<details");
  });

  it("spreads sections in a justify-between container", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "Left", href: "l" }] }, { items: [{ label: "Right", href: "r" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toContain("justify-between");
    expect(count(out, 'data-slot="navbar-section"')).toBe(2);
  });

  it("renders the mobile hamburger toggle as md:hidden and the sections container as collapsible", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toContain('data-slot="navbar-toggle"');
    expect(out).toContain("md:hidden");
    expect(out).toContain("hidden group-open:flex md:flex");
    expect(out).toContain('aria-label="Menu"');
  });

  it("renders hamburger and close icons via sprite <use> references", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toContain('href="/sprite.svg#icon-hamburger"');
    expect(out).toContain('href="/sprite.svg#icon-close"');
  });
});

describe("Navbar — links", () => {
  it("resolves href through resolveHref and never emits the raw key", async () => {
    const calls: string[] = [];
    const resolve = (k: string) => {
      calls.push(k);
      return "/secret-path";
    };
    const config: NavDefinition = { sections: [{ items: [{ label: "Dash", href: "dashboard" }] }] };
    const out = await render(<Navbar config={config} resolveHref={resolve} icon={icon} />);
    expect(calls).toEqual(["dashboard"]);
    expect(out).toContain('href="/secret-path"');
    expect(out).not.toContain("dashboard");
    expect(out).toContain('data-slot="navbar-link"');
  });
});

describe("Navbar — menus", () => {
  it("renders a menu as a popover <details>/<summary> with the label and chevron icon", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "File", items: [{ label: "New", href: "new" }] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toContain('data-slot="popover"');
    expect(out).toContain('data-slot="popover-trigger"');
    expect(out).toContain('data-slot="popover-content"');
    expect(out).toContain("File");
    expect(out).toContain("New");
    expect(out).toContain('href="/route/new"');
    expect(out).toContain('href="/sprite.svg#icon-chevron-down"');
  });

  it("nests submenus as nested popover <details>", async () => {
    const config: NavDefinition = {
      sections: [{ items: [{ label: "Edit", items: [{ label: "More", items: [{ label: "Deep", href: "deep" }] }] }] }],
    };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(count(out, 'data-slot="popover"')).toBe(2);
    expect(out).toContain("Deep");
    expect(out).toContain('href="/route/deep"');
  });

  it("links each menu trigger to its popover content via a shared commandfor/id", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "File", items: [{ label: "New", href: "new" }] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toContain('command="toggle-popover"');
    expect(out).toContain('commandfor="navbar-menu-0"');
    expect(out).toContain('id="navbar-menu-0"');
    expect(out).toContain('popover="auto"');
  });

  it("mints a distinct id per nested menu popover", async () => {
    const config: NavDefinition = {
      sections: [{ items: [{ label: "Edit", items: [{ label: "More", items: [{ label: "Deep", href: "deep" }] }] }] }],
    };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toContain('commandfor="navbar-menu-0"');
    expect(out).toContain('commandfor="navbar-menu-1"');
  });
});

describe("Navbar — slots", () => {
  it("renders an inline JSX node slot directly", async () => {
    const config: NavDefinition = { sections: [{ items: [{ slot: <button type='button'>Toggle</button> }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toContain('<button type="button">Toggle</button>');
  });

  it("resolves a string slot from the slots map", async () => {
    const config: NavDefinition = { sections: [{ items: [{ slot: "user_name" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} slots={{ user_name: <span>Ada</span> }} />);
    expect(out).toContain("<span>Ada</span>");
  });

  it("renders nothing and does not throw for a missing string slot", async () => {
    const config: NavDefinition = { sections: [{ items: [{ slot: "absent" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).not.toContain("absent");
    expect(out).toContain('data-slot="navbar"');
  });

  it("renders an optional label beside the slot content", async () => {
    const config: NavDefinition = { sections: [{ items: [{ slot: "x", label: "Hello" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} slots={{ x: <i>!</i> }} />);
    expect(out).toContain("Hello");
    expect(out).toContain("<i>!</i>");
    expect(out).toContain('data-slot="navbar-slot"');
  });
});

describe("Navbar — auth filters", () => {
  it("stamps data-filter and seeds hidden when no active token matches", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "Account", href: "acct", filters: ["user"] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} activeFilters={["guest"]} />);
    expect(out).toContain('data-filter="user"');
    expect(out).toContain('data-filter="user" hidden>');
  });

  it("leaves a matching filtered item visible (no hidden attribute)", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "Account", href: "acct", filters: ["user"] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} activeFilters={["user"]} />);
    expect(out).toContain('data-filter="user"');
    expect(out).toContain('data-filter="user">');
    expect(out).not.toContain('data-filter="user" hidden');
  });

  it("serializes the initial filters into the resumable scope state", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} activeFilters={["user"]} />);
    expect(out).toContain('data-state="{&quot;filters&quot;:[&quot;user&quot;]}"');
  });
});

describe("Navbar — placement", () => {
  it("emits the top placement class string by default", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toContain("sticky left-0 inset-y-0 md:inset-x-0 md:top-0");
    expect(out).toContain("backdrop-blur");
  });

  it("emits the bottom placement class string", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} placement='bottom' />);
    expect(out).toContain("sticky right-0 inset-y-0 md:inset-x-0 md:bottom-0");
  });

  it("merges a custom class onto the root", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} class='my-bar' />);
    expect(out).toContain("my-bar");
    expect(out).toContain("backdrop-blur");
  });

  it("forwards passthrough nav attributes (id, data-ref) to the root", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} id='main-nav' data-ref='nav' />);
    expect(out).toContain('id="main-nav"');
    expect(out).toContain('data-ref="nav"');
  });
});
