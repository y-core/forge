import { describe, expect, it } from "bun:test";
import { hxHeaders } from "./htmx-response";

describe("hxHeaders", () => {
  it("returns empty record when no props given", () => {
    expect(hxHeaders({})).toEqual({});
  });

  it("redirect → HX-Redirect", () => {
    expect(hxHeaders({ redirect: "/new" })).toEqual({ "HX-Redirect": "/new" });
  });

  it("refresh:true → HX-Refresh: true", () => {
    expect(hxHeaders({ refresh: true })).toEqual({ "HX-Refresh": "true" });
  });

  it("refresh:false → omitted", () => {
    expect(hxHeaders({ refresh: false })).toEqual({});
  });

  it("pushUrl → HX-Push-Url", () => {
    expect(hxHeaders({ pushUrl: "/pushed" })).toEqual({ "HX-Push-Url": "/pushed" });
  });

  it("replaceUrl → HX-Replace-Url", () => {
    expect(hxHeaders({ replaceUrl: "/replaced" })).toEqual({ "HX-Replace-Url": "/replaced" });
  });

  it("trigger → HX-Trigger", () => {
    expect(hxHeaders({ trigger: "myEvent" })).toEqual({ "HX-Trigger": "myEvent" });
  });

  it("triggerAfterSettle → HX-Trigger-After-Settle", () => {
    expect(hxHeaders({ triggerAfterSettle: "afterSettle" })).toEqual({ "HX-Trigger-After-Settle": "afterSettle" });
  });

  it("triggerAfterSwap → HX-Trigger-After-Swap", () => {
    expect(hxHeaders({ triggerAfterSwap: "afterSwap" })).toEqual({ "HX-Trigger-After-Swap": "afterSwap" });
  });

  it("retarget → HX-Retarget", () => {
    expect(hxHeaders({ retarget: "#new-target" })).toEqual({ "HX-Retarget": "#new-target" });
  });

  it("reswap → HX-Reswap", () => {
    expect(hxHeaders({ reswap: "outerHTML" })).toEqual({ "HX-Reswap": "outerHTML" });
  });

  it("empty string values are omitted", () => {
    expect(hxHeaders({ redirect: "", trigger: "" })).toEqual({});
  });

  it("multiple props produce all corresponding headers", () => {
    const result = hxHeaders({ redirect: "/done", trigger: "refresh", retarget: "#result" });
    expect(result).toEqual({ "HX-Redirect": "/done", "HX-Trigger": "refresh", "HX-Retarget": "#result" });
  });
});
