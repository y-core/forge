import { describe, expect, it } from "bun:test";
import { Accept, CacheControl, ContentDisposition, ContentRange, ContentType, Range, SetCookie, Vary } from "./mod";

// Facade-contract test: `http/headers.ts` is a pure re-export of `@remix-run/headers`.
// These cases assert the public export path resolves and each key value symbol is
// exported and usable — not the upstream library's own behaviour.
describe("http/headers facade", () => {
  it("exports every value symbol as a constructable class", () => {
    const classes = [Accept, CacheControl, ContentDisposition, ContentRange, ContentType, Range, SetCookie, Vary];
    for (const ctor of classes) {
      expect(typeof ctor).toBe("function");
    }
  });

  it("constructs a CacheControl header value", () => {
    expect(new CacheControl({ maxAge: 3600, public: true }).toString()).toBe("public, max-age=3600");
  });

  it("constructs a SetCookie header value", () => {
    expect(new SetCookie({ name: "flash", value: "saved" }).toString()).toBe("flash=saved");
  });

  it("constructs a ContentType header value", () => {
    expect(new ContentType({ mediaType: "text/html", charset: "utf-8" }).toString()).toBe("text/html; charset=utf-8");
  });

  it("constructs a ContentDisposition header value", () => {
    expect(new ContentDisposition({ type: "attachment", filename: "f.txt" }).toString()).toBe("attachment; filename=f.txt");
  });

  it("constructs a ContentRange header value", () => {
    expect(new ContentRange({ unit: "bytes", start: 0, end: 99, size: 100 }).toString()).toBe("bytes 0-99/100");
  });

  it("constructs a Vary header value", () => {
    expect(new Vary("Accept-Encoding").toString()).toBe("accept-encoding");
  });

  it("constructs an Accept header value", () => {
    expect(new Accept("text/html").toString()).toBe("text/html");
  });

  it("exposes Range as a constructable class", () => {
    expect(new Range("bytes=0-99")).toBeInstanceOf(Range);
  });
});
