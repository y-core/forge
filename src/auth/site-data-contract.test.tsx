/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../testing/render";
import { fakeTree } from "../ui/client/dom.fixture";
import { mountSiteData } from "./client/site-data";
import { SITE_DATA_SCOPE } from "./site-data-contract";
import { AuthSiteData } from "./web/views/site-data";
import { attrsOf } from "./web/web.fixture";

describe("the site-data contract", () => {
  it("has the client post exactly what the view stamped, the token on the header it names", async () => {
    const html = await render(<AuthSiteData path='/auth/signout/site-data' csrfToken='tok-1' csrfHeader='X-Csrf' />);
    const { doc, el } = fakeTree();
    const root = el("DIV", attrsOf(html, `data-scope="${SITE_DATA_SCOPE}"`));
    doc.body.append(root);

    mountSiteData(root as unknown as HTMLElement);

    expect(doc.defaultView.requests).toEqual([
      { url: "/auth/signout/site-data", method: "POST", headers: { "X-Csrf": "tok-1" }, body: undefined, keepalive: true },
    ]);
  });
});
