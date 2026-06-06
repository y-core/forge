/** @jsxImportSource @y-core/forge */
import { describe, expect, it } from "bun:test";
import { renderToString } from "../../jsx/render-to-string";
import {
  asyncDialogTrigger,
  dependentSelect,
  formSubmit,
  infiniteScroll,
  inlineValidation,
  liveSearch,
  oobAppend,
  oobSwap,
  paginatedTableLink,
  SWAP,
  toastOob,
} from "./htmx-patterns";

async function render(element: unknown): Promise<string> {
  return String(await renderToString(element));
}

describe("SWAP", () => {
  it("has correct string values", () => {
    expect(SWAP.innerHtml).toBe("innerHTML");
    expect(SWAP.outerHtml).toBe("outerHTML");
    expect(SWAP.beforeEnd).toBe("beforeend");
    expect(SWAP.afterEnd).toBe("afterend");
    expect(SWAP.beforeBegin).toBe("beforebegin");
    expect(SWAP.delete).toBe("delete");
    expect(SWAP.none).toBe("none");
  });
});

describe("liveSearch", () => {
  it("defaults: swap=innerHTML, trigger includes 300ms delay", () => {
    const attrs = liveSearch({ get: "/search", target: "#results" });
    expect(attrs["hx-get"]).toBe("/search");
    expect(attrs["hx-target"]).toBe("#results");
    expect(attrs["hx-swap"]).toBe("innerHTML");
    expect(attrs["hx-trigger"]).toContain("300ms");
    expect(attrs["hx-trigger"]).toContain("search");
  });

  it("overrides swap and trigger", () => {
    const attrs = liveSearch({ get: "/s", target: "#r", swap: "outerHTML", trigger: "keyup" });
    expect(attrs["hx-swap"]).toBe("outerHTML");
    expect(attrs["hx-trigger"]).toBe("keyup");
  });

  it("includes pushUrl when provided", () => {
    const attrs = liveSearch({ get: "/s", target: "#r", pushUrl: "/search" });
    expect(attrs["hx-push-url"]).toBe("/search");
  });

  it("omits pushUrl when absent", () => {
    const attrs = liveSearch({ get: "/s", target: "#r" });
    expect(attrs).not.toHaveProperty("hx-push-url");
  });
});

describe("inlineValidation", () => {
  it("defaults: swap=outerHTML, trigger=change+blur, sync=closest form", () => {
    const attrs = inlineValidation({ get: "/validate", target: "#field" });
    expect(attrs["hx-get"]).toBe("/validate");
    expect(attrs["hx-swap"]).toBe("outerHTML");
    expect(attrs["hx-trigger"]).toBe("change delay:200ms, blur");
    expect(attrs["hx-sync"]).toBe("closest form:abort");
  });

  it("overrides all defaults", () => {
    const attrs = inlineValidation({ get: "/v", target: "#t", swap: "innerHTML", trigger: "input", sync: "this:abort" });
    expect(attrs["hx-swap"]).toBe("innerHTML");
    expect(attrs["hx-trigger"]).toBe("input");
    expect(attrs["hx-sync"]).toBe("this:abort");
  });
});

describe("paginatedTableLink", () => {
  it("builds correct URL with default pageParam", () => {
    const attrs = paginatedTableLink({ get: "/items", target: "#table", page: 3 });
    expect(attrs["hx-get"]).toBe("/items?page=3");
    expect(attrs["hx-swap"]).toBe("outerHTML");
  });

  it("preserves existing query params on the path", () => {
    const attrs = paginatedTableLink({ get: "/items?sort=asc", target: "#t", page: 2 });
    expect(attrs["hx-get"]).toContain("sort=asc");
    expect(attrs["hx-get"]).toContain("page=2");
  });

  it("merges extra query map and page param overrides last (appears once)", () => {
    const attrs = paginatedTableLink({ get: "/items", target: "#t", page: 2, query: { filter: "active", page: "99" } });
    const url = attrs["hx-get"]!;
    expect(url).toContain("filter=active");
    expect(url).toContain("page=2");
    expect((url.match(/page=/g) ?? []).length).toBe(1);
  });

  it("uses custom pageParam", () => {
    const attrs = paginatedTableLink({ get: "/items", target: "#t", page: 5, pageParam: "p" });
    expect(attrs["hx-get"]).toBe("/items?p=5");
  });

  it("handles absolute URL base path correctly", () => {
    // Absolute URLs still resolve — path+search portion is preserved
    const attrs = paginatedTableLink({ get: "https://api.example.com/items", target: "#t", page: 2 });
    expect(attrs["hx-get"]).toContain("page=2");
  });
});

describe("asyncDialogTrigger", () => {
  it("includes hx-get, target, default swap=innerHTML, and dialog attrs", () => {
    const attrs = asyncDialogTrigger({ get: "/modal", target: "#modal-host", dialogId: "my-dialog" });
    expect(attrs["hx-get"]).toBe("/modal");
    expect(attrs["hx-target"]).toBe("#modal-host");
    expect(attrs["hx-swap"]).toBe("innerHTML");
    expect(attrs["data-dialog-open"]).toBe("my-dialog");
    expect(attrs["aria-haspopup"]).toBe("dialog");
    expect(attrs["aria-controls"]).toBe("my-dialog");
  });

  it("overrides swap", () => {
    const attrs = asyncDialogTrigger({ get: "/m", target: "#t", dialogId: "d", swap: "outerHTML" });
    expect(attrs["hx-swap"]).toBe("outerHTML");
  });
});

describe("dependentSelect", () => {
  it("defaults: swap=outerHTML, trigger=change", () => {
    const attrs = dependentSelect({ get: "/options", target: "#select" });
    expect(attrs["hx-swap"]).toBe("outerHTML");
    expect(attrs["hx-trigger"]).toBe("change");
  });
});

describe("infiniteScroll", () => {
  it("default swap is beforeend", () => {
    const attrs = infiniteScroll({ get: "/more", target: "#list" });
    expect(attrs["hx-swap"]).toBe("beforeend");
    expect(attrs["hx-trigger"]).toBe("revealed");
  });

  it("always uses hx-trigger=revealed even with custom swap", () => {
    const attrs = infiniteScroll({ get: "/more", target: "#list", swap: "outerHTML" });
    expect(attrs["hx-trigger"]).toBe("revealed");
    expect(attrs["hx-swap"]).toBe("outerHTML");
  });

  it("includes select when provided", () => {
    const attrs = infiniteScroll({ get: "/more", target: "#list", select: ".item" });
    expect(attrs["hx-select"]).toBe(".item");
  });
});

describe("formSubmit", () => {
  it("defaults: swap=outerHTML, disabledElt=this", () => {
    const attrs = formSubmit({ post: "/submit", target: "#form" });
    expect(attrs["hx-post"]).toBe("/submit");
    expect(attrs["hx-swap"]).toBe("outerHTML");
    expect(attrs["hx-disabled-elt"]).toBe("this");
  });

  it("overrides disabledElt and includes encoding/pushUrl", () => {
    const attrs = formSubmit({ post: "/submit", target: "#form", disabledElt: ".btn", encoding: "multipart/form-data", pushUrl: "/done" });
    expect(attrs["hx-disabled-elt"]).toBe(".btn");
    expect(attrs["hx-encoding"]).toBe("multipart/form-data");
    expect(attrs["hx-push-url"]).toBe("/done");
  });
});

describe("oobSwap", () => {
  it("no props → hx-swap-oob=true", () => {
    expect(oobSwap({})).toEqual({ "hx-swap-oob": "true" });
  });

  it("selector only → upgrades value to outerHTML and appends selector", () => {
    expect(oobSwap({ selector: "#target" })).toEqual({ "hx-swap-oob": "outerHTML:#target" });
  });

  it("strategy + selector → strategy:selector", () => {
    expect(oobSwap({ strategy: "beforeend", selector: "#list" })).toEqual({ "hx-swap-oob": "beforeend:#list" });
  });

  it("strategy alone (no selector) → strategy string", () => {
    expect(oobSwap({ strategy: "outerHTML" })).toEqual({ "hx-swap-oob": "outerHTML" });
  });
});

describe("oobAppend", () => {
  it("returns beforeend:<selector>", () => {
    expect(oobAppend("#flash")).toEqual({ "hx-swap-oob": "beforeend:#flash" });
  });
});

describe("toastOob", () => {
  it("renders toast markup with default hx-swap-oob to #toast-container", async () => {
    const node = toastOob({ toast: { title: "Done", description: "It worked" } });
    const out = await render(node);
    expect(out).toContain("hx-swap-oob");
    expect(out).toContain("beforeend:#toast-container");
    expect(out).toContain("Done");
    expect(out).toContain("It worked");
  });

  it("uses custom selector and strategy", async () => {
    const node = toastOob({ toast: { title: "Custom" }, selector: "#notifications", strategy: "afterend" });
    const out = await render(node);
    expect(out).toContain("afterend:#notifications");
  });
});
