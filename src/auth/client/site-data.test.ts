import { describe, expect, it } from "bun:test";

import { fakeTree } from "../../ui/client/dom.fixture";
import { SITE_DATA_CSRF_HEADER_ATTR, SITE_DATA_PATH_ATTR, SITE_DATA_TOKEN_ATTR } from "../site-data-contract";
import { mountSiteData } from "./site-data";

const PATH = "/auth/signout/site-data";

function scopeRoot(attrs: Record<string, string>) {
  const { doc, el } = fakeTree();
  const root = el("DIV", attrs);
  doc.body.append(root);
  return { root: root as unknown as HTMLElement, win: doc.defaultView };
}

const COMPLETE: Record<string, string> = {
  [SITE_DATA_PATH_ATTR]: PATH,
  [SITE_DATA_TOKEN_ATTR]: "tok",
  [SITE_DATA_CSRF_HEADER_ATTR]: "X-CSRF-Token",
};

describe("mountSiteData", () => {
  it("posts once to the declared path with the token on the declared header", () => {
    const { root, win } = scopeRoot(COMPLETE);

    mountSiteData(root);

    expect(win.requests).toEqual([{ url: PATH, method: "POST", headers: { "X-CSRF-Token": "tok" }, body: undefined, keepalive: true }]);
  });

  for (const missing of [SITE_DATA_PATH_ATTR, SITE_DATA_TOKEN_ATTR, SITE_DATA_CSRF_HEADER_ATTR]) {
    it(`posts nothing when ${missing} is missing`, () => {
      const { [missing]: _dropped, ...rest } = COMPLETE;
      const { root, win } = scopeRoot(rest);

      mountSiteData(root);

      expect(win.requests).toEqual([]);
    });
  }

  // Bun fails the run on an unhandled rejection, so reaching the assertion is the claim.
  it("swallows a network failure rather than leaving an unhandled rejection", async () => {
    const { root, win } = scopeRoot(COMPLETE);
    win.replies.set(PATH, null);

    mountSiteData(root);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(win.requests.length).toBe(1);
  });
});
