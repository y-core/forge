import { describe, expect, it } from "bun:test";

import { logSafeUrl, urlNarrowing } from "./log-value";

describe("logSafeUrl", () => {
  it("keeps the origin and the path", () => {
    expect(logSafeUrl(new URL("https://app.example.com/reset/step-2"))).toBe("https://app.example.com/reset/step-2");
  });

  it("drops the query string, where a credential travels", () => {
    expect(logSafeUrl(new URL("https://app.example.com/reset?token=SECRET&next=/home"))).toBe("https://app.example.com/reset");
  });

  it("drops the fragment", () => {
    expect(logSafeUrl(new URL("https://app.example.com/docs#section"))).toBe("https://app.example.com/docs");
  });

  it("drops userinfo with the rest of the authority the origin omits", () => {
    expect(logSafeUrl(new URL("https://user:pw@app.example.com/x"))).toBe("https://app.example.com/x");
  });

  it("keeps a non-default port, which is part of the origin", () => {
    expect(logSafeUrl(new URL("http://localhost:8787/api/v1"))).toBe("http://localhost:8787/api/v1");
  });
});

describe("urlNarrowing", () => {
  it("narrows a URL value to origin and path", () => {
    expect(JSON.parse(JSON.stringify({ to: new URL("https://a.example/x?k=SECRET") }, urlNarrowing))).toStrictEqual({ to: "https://a.example/x" });
  });

  it("narrows a URL nested in an object or an array", () => {
    const value = { hops: [{ to: new URL("https://a.example/one?k=SECRET") }, new URL("https://b.example/two#f")] };
    expect(JSON.parse(JSON.stringify(value, urlNarrowing))).toStrictEqual({ hops: [{ to: "https://a.example/one" }, "https://b.example/two"] });
  });

  it("narrows a URL passed as the whole value", () => {
    expect(JSON.stringify(new URL("https://a.example/x?k=SECRET"), urlNarrowing)).toBe('"https://a.example/x"');
  });

  it("leaves a string that merely looks like a URL untouched", () => {
    expect(JSON.parse(JSON.stringify({ to: "https://a.example/x?k=keep" }, urlNarrowing))).toStrictEqual({ to: "https://a.example/x?k=keep" });
  });

  it("leaves every other value to JSON.stringify, toJSON included", () => {
    const value = { at: new Date("2026-05-31T10:00:00.000Z"), session: { toJSON: () => ({ id: "s1" }) }, n: 1, nested: { flag: false } };
    expect(JSON.parse(JSON.stringify(value, urlNarrowing))).toStrictEqual({
      at: "2026-05-31T10:00:00.000Z",
      session: { id: "s1" },
      n: 1,
      nested: { flag: false },
    });
  });
});
