import { describe, expect, it } from "bun:test";
import { fakeTree } from "../client/test-dom";
import {
  LAZY_DEMO_LOADED,
  LAZY_DEMO_STATUS_REF,
  LAZY_PANEL_ROWS,
  LAZY_PANEL_TITLE,
  LAZY_RETRY_LOADED,
  LAZY_RETRY_STATUS_REF,
} from "./lazy-contract";
import { mountLazyPanel, mountRetryPanel } from "./lazy-panel";

/** The anchor as the server renders it: a box holding one status line. */
function panelWith(statusRef: string) {
  const { el } = fakeTree();
  const panel = el("DIV");
  const status = el("P", { "data-ref": statusRef });
  panel.append(status);
  return { panel, status };
}

describe("mountLazyPanel", () => {
  it("writes the loaded line into the panel status", () => {
    const { panel, status } = panelWith(LAZY_DEMO_STATUS_REF);

    mountLazyPanel(panel as unknown as Element);

    expect(status.textContent).toBe(LAZY_DEMO_LOADED);
  });

  it("builds the payload the deferral was holding back, one row per entry", () => {
    const { panel } = panelWith(LAZY_DEMO_STATUS_REF);

    mountLazyPanel(panel as unknown as Element);

    const list = panel.querySelector("ul");
    expect(list).not.toBeNull();
    expect(list?.children).toHaveLength(LAZY_PANEL_ROWS.length);
    expect(list?.children.map((item) => item.children.map((cell) => cell.textContent))).toEqual(LAZY_PANEL_ROWS.map((row) => [row.name, row.cost]));
    // The status line is the first `<p>` and the server rendered it; the title arrived with the module.
    expect(panel.querySelectorAll("p").map((p) => p.textContent)).toEqual([LAZY_DEMO_LOADED, LAZY_PANEL_TITLE]);
  });

  // `lazy()` calls `init` once per element, but a re-resumed scope would call it again — and two
  // copies of the payload is the visible failure.
  it("appends the payload once, however many times it is mounted", () => {
    const { panel } = panelWith(LAZY_DEMO_STATUS_REF);

    mountLazyPanel(panel as unknown as Element);
    mountLazyPanel(panel as unknown as Element);

    expect(panel.querySelectorAll("ul")).toHaveLength(1);
  });

  it("leaves a panel with no status line alone", () => {
    const { el } = fakeTree();
    const panel = el("DIV");

    expect(() => mountLazyPanel(panel as unknown as Element)).not.toThrow();
    expect(panel.querySelector("ul")).not.toBeNull();
  });
});

describe("mountRetryPanel", () => {
  it("writes the line naming the attempt that finally resolved, and the same payload", () => {
    const { panel, status } = panelWith(LAZY_RETRY_STATUS_REF);

    mountRetryPanel(panel as unknown as Element);

    expect(status.textContent).toBe(LAZY_RETRY_LOADED);
    expect(panel.querySelector("ul")?.children).toHaveLength(LAZY_PANEL_ROWS.length);
  });
});
