import { describe, expect, it } from "bun:test";

import { RequestContext } from "../../context/types";
import { AUTH_REDIRECT_STATUS, createAuthRedirect } from "./redirect";

function contextOf(headers: Record<string, string> = {}): RequestContext {
  return new RequestContext(new Request("http://forge.test/admin/users/u2", { method: "DELETE", headers }));
}

const answerOf = (res: Response) => ({
  status: res.status,
  location: res.headers.get("location"),
  redirect: res.headers.get("hx-redirect"),
  body: res.body,
});

describe("createAuthRedirect", () => {
  it("answers a plain request with a 303, so the browser follows it by GET", () => {
    expect(AUTH_REDIRECT_STATUS).toBe(303);
    expect(answerOf(createAuthRedirect(contextOf(), "/admin/users"))).toEqual({
      status: 303,
      location: "/admin/users",
      redirect: null,
      body: null,
    });
  });

  it("answers a plain request with the status its caller chose", () => {
    expect(answerOf(createAuthRedirect(contextOf(), "/auth/signin?next=%2Faccount", 302))).toMatchObject({
      status: 302,
      location: "/auth/signin?next=%2Faccount",
    });
  });

  it("answers an htmx request with an empty 204 carrying HX-Redirect and no Location, whatever status was asked for", () => {
    for (const status of [undefined, 302]) {
      expect(answerOf(createAuthRedirect(contextOf({ "HX-Request": "true" }), "/admin/users", status))).toEqual({
        status: 204,
        location: null,
        redirect: "/admin/users",
        body: null,
      });
    }
  });

  it("treats an HX-Request header other than `true` as a plain request", () => {
    expect(createAuthRedirect(contextOf({ "HX-Request": "false" }), "/admin/users").status).toBe(303);
  });
});
