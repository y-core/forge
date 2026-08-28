import { describe, expect, it } from "bun:test";
import { dnsName, prefixedName, sanitizeName } from "./naming";

describe("prefixedName()", () => {
  it("joins the project prefix to the binding", () => {
    expect(prefixedName("CORNELLAW", "MAIN_LIMITER")).toBe("CORNELLAW_MAIN_LIMITER");
  });

  it("returns the binding alone when there is no prefix", () => {
    expect(prefixedName("", "MAIN_KV")).toBe("MAIN_KV");
  });
});

describe("dnsName()", () => {
  it("lowercases the prefix as well as the binding", () => {
    // The old rule normalised only the binding, yielding `MY_WORKER-my-bucket` —
    // neither naming rule, and not a legal bucket name.
    expect(dnsName("MY_WORKER", "MY_BUCKET")).toBe("my-worker-my-bucket");
  });

  it("is the same name as prefixedName, only normalised", () => {
    expect(dnsName("PROJ", "ASSETS")).toBe(prefixedName("PROJ", "ASSETS").toLowerCase().replace(/_/g, "-"));
  });

  it("normalises a bare binding when there is no prefix", () => {
    expect(dnsName("", "MY_BUCKET")).toBe("my-bucket");
  });
});

describe("sanitizeName()", () => {
  it("replaces every non-word character, not merely the hyphen", () => {
    // A project name is not an identifier: `my.app` is legal, and the old rule
    // replaced only `-`, leaving the dot in the resource name it produced.
    expect(sanitizeName("MY.APP")).toBe("MY_APP");
    expect(sanitizeName("my app")).toBe("my_app");
    expect(sanitizeName("scope/pkg")).toBe("scope_pkg");
  });

  it("leaves an already-safe name untouched", () => {
    expect(sanitizeName("MY_WORKER_1")).toBe("MY_WORKER_1");
  });
});

describe("naming a project whose name is not an identifier", () => {
  it("keeps the prefixed form free of stray punctuation", () => {
    expect(prefixedName("MY.APP", "CACHE")).toBe("MY_APP_CACHE");
  });

  it("produces a legal DNS-shaped name from it", () => {
    // `my.app-assets` is not a legal bucket name; the dot has to go.
    expect(dnsName("MY.APP", "ASSETS")).toBe("my-app-assets");
  });

  it("collapses runs and trims the ends", () => {
    expect(dnsName("__PROJ__", "__BUCKET__")).toBe("proj-bucket");
  });
});
