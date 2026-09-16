/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Link } from "./link";
import { attrsOf, classesOf, variantClasses } from "./test-support";

const anchor = (props: Parameters<typeof Link>[0] = {}) => render(<Link {...props}>go</Link>);

describe("Link", () => {
  it("renders the whole anchor exactly, caller class merged last and children escaped", async () => {
    expect(
      await render(
        <Link decoration='plain' class='font-bold' id='l1' data-note='a&b'>
          {`R&D's`}
        </Link>,
      ),
    ).toBe(
      '<a data-slot="link" data-tone="primary" data-decoration="plain" class="[--tone:var(--color-primary)]' +
        " [--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)] [--tone-soft:var(--color-primary-soft)]" +
        " [--tone-soft-fg:var(--color-primary-soft-foreground)] [--tone-soft-border:var(--color-primary-soft-border)]" +
        ' rounded-sm text-(--tone-text) focus-ring-outset no-underline font-bold" id="l1" data-note="a&amp;b">R&amp;D&#39;s</a>',
    );
  });

  it("stamps both axes as attributes, so a variant is readable without reading a class list", async () => {
    expect(attrsOf(await anchor({ href: "/a" }))).toEqual({
      "data-slot": "link",
      "data-tone": "primary",
      "data-decoration": "underline",
      href: "/a",
    });
  });

  it("names the tone it was given on the attribute a stylesheet and a reader both key on", async () => {
    expect(attrsOf(await anchor({ tone: "warning", decoration: "hover" }))).toEqual({
      "data-slot": "link",
      "data-tone": "warning",
      "data-decoration": "hover",
    });
  });

  it("swaps the whole tone palette rather than overlaying a second one", async () => {
    const { added, dropped } = variantClasses(await anchor({ tone: "warning" }), await anchor());

    expect(added.every((token) => token.startsWith("[--tone"))).toBe(true);
    expect(dropped.every((token) => token.startsWith("[--tone"))).toBe(true);
    expect(added.length).toBe(dropped.length);
  });

  it("holds the underline back until hover rather than leaving the resting one in place", async () => {
    expect(variantClasses(await anchor({ decoration: "hover" }), await anchor())).toEqual({
      added: ["no-underline", "hover:underline"],
      dropped: ["underline", "underline-offset-4"],
    });
  });

  it("drops the underline outright for the plain decoration, which is what distinguishes it from hover", async () => {
    expect(variantClasses(await anchor({ decoration: "plain" }), await anchor())).toEqual({
      added: ["no-underline"],
      dropped: ["underline", "underline-offset-4"],
    });
  });

  it("merges its own styling onto a single element child under asChild, the child's class winning a conflict", async () => {
    const html = await render(
      <Link asChild>
        <a href='/c' class='block'>
          kid
        </a>
      </Link>,
    );

    expect(attrsOf(html)).toEqual({ href: "/c", "data-tone": "primary", "data-decoration": "underline", "data-slot": "link" });
    expect(classesOf(html).at(-1)).toBe("block");
    expect(html).toEndWith(">kid</a>");
  });

  it("throws when asChild receives no single element child", async () => {
    expect(() => render(<Link asChild>text</Link>)).toThrow(
      "Link with asChild requires exactly one JSX element child (e.g. an <a> from a router); received a string, number, fragment, array, or empty child instead.",
    );
  });
});
