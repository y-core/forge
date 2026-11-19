import { describe, expect, it } from "bun:test";

import { hardenedText } from "./hardened-response";

describe("hardenedText", () => {
  it("answers plain text under the baseline hardening headers, with the status it is given", async () => {
    const res = hardenedText("Not Found", 404);

    expect(res.status).toBe(404);
    expect(Object.fromEntries(res.headers)).toEqual({
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
      "referrer-policy": "no-referrer",
    });
    expect(await res.text()).toBe("Not Found");
  });

  it("sets the extra headers last, so they add to the baseline", () => {
    const res = hardenedText("Method Not Allowed", 405, { allow: "GET, HEAD" });

    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
