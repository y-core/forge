/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { AuthSiteData } from "./site-data";

describe("AuthSiteData", () => {
  it("renders one hidden element carrying the scope, the path, the token and the header", async () => {
    expect(await render(<AuthSiteData path='/auth/signout/site-data' csrfToken='a&b' csrfHeader='X-CSRF-Token' />)).toBe(
      '<div hidden data-scope="auth-site-data" data-site-data-path="/auth/signout/site-data" data-site-data-token="a&amp;b" data-site-data-csrf-header="X-CSRF-Token"></div>',
    );
  });
});
