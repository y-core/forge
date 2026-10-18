import { describe, expect, it } from "bun:test";

import { dnsName, prefixedName, previewName, sanitizeName } from "./naming";

describe("prefixedName()", () => {
  it("joins the project prefix to the binding", () => {
    expect(prefixedName("NAMING", "MAIN_LIMITER")).toBe("NAMING_MAIN_LIMITER");
  });

  it("returns the binding alone when there is no prefix", () => {
    expect(prefixedName("", "MAIN_KV")).toBe("MAIN_KV");
  });
});

describe("dnsName()", () => {
  it("lowercases the prefix as well as the binding", () => {
    expect(dnsName("MY_WORKER", "MY_BUCKET")).toBe("my-worker-my-bucket");
  });

  it("is the same name as prefixedName, only normalised", () => {
    expect(dnsName("PROJ", "ASSETS")).toBe(prefixedName("PROJ", "ASSETS").toLowerCase().replace(/_/g, "-"));
  });

  it("normalises a bare binding when there is no prefix", () => {
    expect(dnsName("", "MY_BUCKET")).toBe("my-bucket");
  });
});

describe("previewName()", () => {
  it("suffixes an explicit database_name, whatever the prefix", () => {
    expect(previewName({ binding: "DB", database_name: "app-db" }, "APP")).toBe("app-db-preview");
  });

  it("suffixes the prefixed name when the entry has no database_name, so two Workers binding DB never share one", () => {
    expect(previewName({ binding: "DB" }, "APP")).toBe("APP_DB-preview");
  });

  it("suffixes the bare binding when there is no prefix", () => {
    expect(previewName({ binding: "DB" }, "")).toBe("DB-preview");
  });
});

describe("sanitizeName()", () => {
  it("replaces every non-word character, not merely the hyphen", () => {
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
    expect(dnsName("MY.APP", "ASSETS")).toBe("my-app-assets");
  });

  it("collapses runs and trims the ends", () => {
    expect(dnsName("__PROJ__", "__BUCKET__")).toBe("proj-bucket");
  });
});
