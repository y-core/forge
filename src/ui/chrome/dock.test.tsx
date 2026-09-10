/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { createIcon } from "../core/icon";
import { Dock } from "./dock";
import type { DockItem } from "./types";

const icon = createIcon("/sprite.svg", { "icon-home": "0 0 24 24", "icon-search": "0 0 24 24" });
const href = (key: string) => `/route/${key}`;

const ROOT = "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]";
const LIST = '<ul data-slot="dock-list" class="m-0 grid list-none auto-cols-fr grid-flow-col p-0">';
const ITEM =
  "flex flex-col items-center gap-1 text-xs text-muted-foreground focus-ring aria-[current]:font-semibold aria-[current]:text-foreground";

function glyph(name: string, px: number): string {
  return `<svg data-slot="icon" width="${px}" height="${px}" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-${name}"></use></svg>`;
}

const TWO: DockItem<"home" | "search">[] = [
  { label: "Home", href: "home", icon: "home", current: true },
  { label: "Search", href: "search", icon: "search" },
];

describe("Dock", () => {
  it("renders a fixed bottom nav of resolved links, hidden from md, with the current one marked", async () => {
    expect(await render(<Dock items={TWO} resolveHref={href} icon={icon} />)).toBe(
      `<nav aria-label="Primary" data-slot="dock" data-size="md" class="${ROOT} md:hidden">${LIST}` +
        `<li><a href="/route/home" data-slot="dock-item" aria-current="page" data-selected="" class="${ITEM} py-2">${glyph("home", 20)}<span data-slot="dock-label">Home</span></a></li>` +
        `<li><a href="/route/search" data-slot="dock-item" class="${ITEM} py-2">${glyph("search", 20)}<span data-slot="dock-label">Search</span></a></li>` +
        `</ul></nav>`,
    );
  });

  it("scales the glyph and the row with size, and hides above lg when asked", async () => {
    expect(await render(<Dock items={[TWO[1] as DockItem<"home" | "search">]} resolveHref={href} icon={icon} size='lg' hideAbove='lg' />)).toBe(
      `<nav aria-label="Primary" data-slot="dock" data-size="lg" class="${ROOT} lg:hidden">${LIST}` +
        `<li><a href="/route/search" data-slot="dock-item" class="${ITEM.replace("text-xs ", "")} py-3 text-sm">${glyph("search", 24)}<span data-slot="dock-label">Search</span></a></li>` +
        `</ul></nav>`,
    );
  });

  it("stamps data-filter on a filtered item and hides it until a token is active", async () => {
    const items: DockItem<"home" | "search">[] = [{ label: "Search", href: "search", icon: "search", filters: ["user", "admin"] }];
    const hidden = await render(<Dock items={items} resolveHref={href} icon={icon} hideAbove='never' />);
    expect(hidden).toBe(
      `<nav aria-label="Primary" data-slot="dock" data-size="md" class="${ROOT}">${LIST}` +
        `<li data-filter="user admin" hidden><a href="/route/search" data-slot="dock-item" class="${ITEM} py-2">${glyph("search", 20)}<span data-slot="dock-label">Search</span></a></li>` +
        `</ul></nav>`,
    );
    expect(await render(<Dock items={items} resolveHref={href} icon={icon} hideAbove='never' activeFilters={["admin"]} />)).toBe(
      hidden.replace('data-filter="user admin" hidden', 'data-filter="user admin"'),
    );
  });

  it("takes a label, merges a caller class last, composes an inherited data-slot, and forwards attributes with escaped values", async () => {
    expect(await render(<Dock items={[]} resolveHref={href} icon={icon} label={`R&D's`} class='static' data-slot='tabs' data-note='a&b' />)).toBe(
      `<nav aria-label="R&amp;D&#39;s" data-slot="dock tabs" data-size="md" class="inset-x-0 bottom-0 z-40 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden static" data-note="a&amp;b">${LIST}</ul></nav>`,
    );
  });

  it("escapes an item label", async () => {
    expect(await render(<Dock items={[{ label: `R&D's`, href: "home", icon: "home" }]} resolveHref={href} icon={icon} hideAbove='never' />)).toBe(
      `<nav aria-label="Primary" data-slot="dock" data-size="md" class="${ROOT}">${LIST}` +
        `<li><a href="/route/home" data-slot="dock-item" class="${ITEM} py-2">${glyph("home", 20)}<span data-slot="dock-label">R&amp;D&#39;s</span></a></li>` +
        `</ul></nav>`,
    );
  });
});
