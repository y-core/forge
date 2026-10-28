/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { describe, expect, it } from "bun:test";

import { Fragment } from "../../../render/jsx/element";
import type { FC, JSXNode } from "../../../render/jsx/types";
import { attrOf } from "../../../testing/markup";
import { render } from "../../../testing/render";
import { aliasPart, fillPartProps } from "./part-props";

const Part: FC<{ tone?: string | undefined }> = ({ tone, children }) => <span data-tone={tone ?? "unset"}>{children}</span>;
const Other: FC<{ tone?: string | undefined }> = ({ tone, children }) => <em data-tone={tone ?? "unset"}>{children}</em>;
const Wrapper: FC<{ tone?: string | undefined }> = (props) => <Part {...props} />;
const Unrelated: FC = ({ children }) => <b>{children}</b>;

const FILLS = new Map([[Part, { tone: "filled" }]]);
const tonesOf = async (node: JSXNode) => [...(await render(fillPartProps(node, FILLS))).matchAll(/data-tone="([^"]*)"/g)].map((m) => m[1]);

describe("fillPartProps", () => {
  it("fills every part in an array", async () => {
    expect(await tonesOf([<Part />, <Part />])).toEqual(["filled", "filled"]);
  });

  it("reaches a part through a Fragment and an intrinsic wrapper", async () => {
    expect(
      await tonesOf(
        <Fragment>
          <div>
            <Part />
          </div>
        </Fragment>,
      ),
    ).toEqual(["filled"]);
  });

  it("reaches a part nested inside another part", async () => {
    expect(
      await tonesOf(
        <Part>
          <Part />
        </Part>,
      ),
    ).toEqual(["filled", "filled"]);
  });

  it("leaves a component it was not given alone, children included", async () => {
    expect(
      await tonesOf(
        <Unrelated>
          <Part />
        </Unrelated>,
      ),
    ).toEqual(["unset"]);
    expect(await tonesOf(<Other />)).toEqual(["unset"]);
  });

  it("keeps a prop the part set explicitly", async () => {
    expect(await tonesOf(<Part tone='own' />)).toEqual(["own"]);
  });

  it("passes text through untouched", async () => {
    expect(await render(fillPartProps("plain", FILLS))).toBe("plain");
  });
});

describe("aliasPart", () => {
  it("fills a wrapper with the props of the part it stands in for", async () => {
    aliasPart(Wrapper, Part);

    expect(attrOf(await render(fillPartProps(<Wrapper />, FILLS)), "data-tone")).toBe("filled");
  });
});
