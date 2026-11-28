/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { describe, expect, it } from "bun:test";

import { attrOf, tagsOf } from "../../testing/markup";
import { render } from "../../testing/render";
import { DescriptionList } from "./mod";

const tagNames = (html: string) => tagsOf(html).map((tag) => /^<([a-z]+)/.exec(tag)?.[1]);

describe("DescriptionList, as the ui/core barrel publishes it", () => {
  it("renders terms and details inside one description list", async () => {
    const html = await render(
      <DescriptionList>
        <DescriptionList.Term>Owner</DescriptionList.Term>
        <DescriptionList.Details>Ada</DescriptionList.Details>
      </DescriptionList>,
    );

    expect(tagNames(html)).toEqual(["dl", "dt", "dd"]);
    expect(html.split(/<[^>]+>/).filter(Boolean)).toEqual(["Owner", "Ada"]);
  });

  it("puts no link in a term given no href", async () => {
    expect(tagNames(await render(<DescriptionList.Term>Owner</DescriptionList.Term>))).toEqual(["dt"]);
  });

  it("links a term given an href, inside the term", async () => {
    const html = await render(<DescriptionList.Term href='/people/ada'>Owner</DescriptionList.Term>);

    expect(tagNames(html)).toEqual(["dt", "a"]);
    expect(attrOf(html, "href", "href")).toBe("/people/ada");
  });

  it("never renders a script-scheme href live", async () => {
    const html = await render(<DescriptionList.Term href='javascript:alert(1)'>Owner</DescriptionList.Term>);

    expect(attrOf(html, "href", "href")).toBe("#");
  });
});
