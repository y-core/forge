import { describe, expect, it } from "bun:test";
import type { Context } from "hono";
import { index, layout, prefix, route } from "./config";

const handler = (c: Context) => c.text("ok");
const mw = async (_c: Context, next: () => Promise<void>) => next();

describe("route()", () => {
  it("creates an entry with path and module", () => {
    const entry = route("/foo", { loader: handler });
    expect(entry.path).toBe("/foo");
    expect(entry.module.loader).toBe(handler);
    expect(entry.index).toBeUndefined();
    expect(entry.children).toBeUndefined();
  });

  it("attaches children when provided", () => {
    const child = route("/bar", { loader: handler });
    const entry = route("/foo", { loader: handler }, [child]);
    expect(entry.children).toHaveLength(1);
    expect(entry.children![0]).toBe(child);
  });

  it("does not set children key when omitted", () => {
    const entry = route("/foo", { loader: handler });
    expect(Object.keys(entry)).not.toContain("children");
  });
});

describe("index()", () => {
  it("creates an index entry with no path", () => {
    const entry = index({ loader: handler });
    expect(entry.index).toBe(true);
    expect(entry.path).toBeUndefined();
    expect(entry.module.loader).toBe(handler);
  });
});

describe("layout()", () => {
  it("creates an entry with no path and attached children", () => {
    const child = route("/bar", { loader: handler });
    const entry = layout({ middleware: mw }, [child]);
    expect(entry.path).toBeUndefined();
    expect(entry.index).toBeUndefined();
    expect(entry.module.middleware).toBe(mw);
    expect(entry.children).toHaveLength(1);
  });
});

describe("prefix()", () => {
  it("prepends a path segment to each entry's path", () => {
    const routes = [route("/health", { loader: handler }), route("/contact", { action: handler })];
    const result = prefix("/api", routes);
    expect(result[0].path).toBe("/api/health");
    expect(result[1].path).toBe("/api/contact");
  });

  it("does not modify entries without a path (layout entries)", () => {
    const lout = layout({ middleware: mw }, []);
    const result = prefix("/api", [lout]);
    expect(result[0].path).toBeUndefined();
  });

  it("preserves other entry properties", () => {
    const child = route("/child", { loader: handler });
    const entry = route("/base", { loader: handler }, [child]);
    const [result] = prefix("/v1", [entry]);
    expect(result.children).toBe(entry.children);
    expect(result.module).toBe(entry.module);
  });
});
