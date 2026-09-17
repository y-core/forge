import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Avatar } from "./avatar";
import { attrOf, attrsOf, classesOf, tagOf, variantClasses } from "./core.fixture";

const contentOf = (html: string): string => html.slice(tagOf(html).length, html.lastIndexOf("<"));

describe("Avatar", () => {
  it("renders the whole frame exactly, forwarded values escaped and placed after the class", async () => {
    expect(await render(<Avatar id='a1' data-testid='avatar' data-note='a&b' aria-label={`R&D's "n" <x>`} />)).toBe(
      '<span data-slot="avatar" data-size="md" class="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted size-10 text-sm" id="a1" data-testid="avatar" data-note="a&amp;b" aria-label="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;"></span>',
    );
  });

  it("is a span at the md size, so a variant is readable without reading a class list", async () => {
    const html = await render(<Avatar />);

    expect(tagOf(html).startsWith("<span ")).toBe(true);
    expect(attrsOf(html)).toEqual({ "data-slot": "avatar", "data-size": "md" });
  });

  it("swaps the whole frame and type step at the sm size rather than overlaying a second one", async () => {
    const html = await render(<Avatar size='sm' />);

    expect(attrOf(html, "data-size")).toBe("sm");
    expect(variantClasses(html, await render(<Avatar />))).toEqual({ added: ["size-8", "text-xs"], dropped: ["size-10", "text-sm"] });
  });

  it("swaps the whole frame and type step at the lg size rather than overlaying a second one", async () => {
    const html = await render(<Avatar size='lg' />);

    expect(attrOf(html, "data-size")).toBe("lg");
    expect(variantClasses(html, await render(<Avatar />))).toEqual({ added: ["size-14", "text-base"], dropped: ["size-10", "text-sm"] });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Avatar class='ring-2 ring-primary' />)).at(-1)).toBe("ring-primary");
  });

  it("nests the fallback it was given inside the frame", async () => {
    const html = await render(
      <Avatar>
        <Avatar.Fallback>AB</Avatar.Fallback>
      </Avatar>,
    );

    expect([...html.matchAll(/data-slot="([^"]*)"/g)].map((match) => match[1])).toEqual(["avatar", "avatar-fallback"]);
    expect(contentOf(html).endsWith(">AB</span>")).toBe(true);
  });

  it("composes a caller data-slot onto its own token rather than replacing it", async () => {
    expect(attrOf(await render(<Avatar data-slot='profile' />), "data-slot")).toBe("avatar profile");
  });
});

describe("Avatar.Image", () => {
  it("is an img carrying the src and the alt text it was given", async () => {
    const html = await render(<Avatar.Image src='/avatars/alice.jpg' alt='Alice Smith' />);

    expect(tagOf(html).startsWith("<img ")).toBe(true);
    expect(attrsOf(html)).toEqual({ "data-slot": "avatar-image", alt: "Alice Smith", src: "/avatars/alice.jpg" });
  });

  it("composes a caller data-slot onto its own token rather than replacing it", async () => {
    expect(attrOf(await render(<Avatar.Image src='/u.jpg' alt='User' data-slot='photo' />), "data-slot")).toBe("avatar-image photo");
  });
});

describe("Avatar.Fallback", () => {
  it("renders the initials it was given under its own slot token", async () => {
    const html = await render(<Avatar.Fallback>AB</Avatar.Fallback>);

    expect(attrsOf(html)).toEqual({ "data-slot": "avatar-fallback" });
    expect(contentOf(html)).toBe("AB");
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Avatar.Fallback class='text-lg'>XL</Avatar.Fallback>)).at(-1)).toBe("text-lg");
  });

  it("forwards an id and data-* and aria-* attributes, with the values escaped", async () => {
    expect(
      attrsOf(
        await render(
          <Avatar.Fallback id='f1' data-testid='fallback' data-note='a&b' aria-label={`R&D's "n" <x>`}>
            AB
          </Avatar.Fallback>,
        ),
      ),
    ).toEqual({
      "data-slot": "avatar-fallback",
      id: "f1",
      "data-testid": "fallback",
      "data-note": "a&amp;b",
      "aria-label": "R&amp;D&#39;s &quot;n&quot; &lt;x&gt;",
    });
  });

  it("composes a caller data-slot onto its own token rather than replacing it", async () => {
    expect(attrOf(await render(<Avatar.Fallback data-slot='initials'>AB</Avatar.Fallback>), "data-slot")).toBe("avatar-fallback initials");
  });
});
