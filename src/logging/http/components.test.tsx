/** @jsxImportSource @y-core/forge */
import { describe, expect, it } from "bun:test";
import { renderToString } from "hono/jsx/dom/server";
import { createIcon } from "../../ui/core/icon";
import { LogFilterBar, LogLevelBadge, LogTableBody } from "./components";
import type { LogRow } from "./reader";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });

function row(overrides?: Partial<LogRow>): LogRow {
  return {
    key: "logs||2026-05-31T10:00:00.000Z||aaa",
    level: "info",
    prefix: "svc",
    message: "test message",
    timestamp: "2026-05-31T10:00:00.000Z",
    ...overrides,
  };
}

describe("LogLevelBadge", () => {
  it("renders the level text", () => {
    const html = renderToString(<LogLevelBadge level="warn" />);
    expect(html).toBe('<span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide bg-amber-100 text-amber-700">warn</span>');
  });

  it("renders error variant", () => {
    const html = renderToString(<LogLevelBadge level="error" />);
    expect(html).toContain("bg-red-100 text-red-700");
    expect(html).toContain("error");
  });

  it("renders debug variant", () => {
    const html = renderToString(<LogLevelBadge level="debug" />);
    expect(html).toContain("bg-brand-100 text-brand-600");
  });

  it("falls back to info style for unknown levels", () => {
    const html = renderToString(<LogLevelBadge level="unknown" />);
    expect(html).toContain("bg-blue-100 text-blue-700");
  });
});

describe("LogTableBody", () => {
  it("renders an empty-state row when rows is empty", () => {
    const html = renderToString(
      <LogTableBody rows={[]} complete={true} loadMoreAction="/admin/logs" />,
    );
    expect(html).toContain("No log entries found.");
  });

  it("renders a row for each log entry", () => {
    const rows: LogRow[] = [
      row({ message: "first event" }),
      row({ message: "second event", level: "error" }),
    ];
    const html = renderToString(
      <LogTableBody rows={rows} complete={true} loadMoreAction="/admin/logs" />,
    );
    expect(html).toContain("first event");
    expect(html).toContain("second event");
  });

  it("renders — when requestId is absent", () => {
    const html = renderToString(
      <LogTableBody rows={[row()]} complete={true} loadMoreAction="/admin/logs" />,
    );
    // Hono JSX renders the em-dash as the literal character, not an HTML entity
    expect(html).toContain("—");
  });

  it("renders requestId when present", () => {
    const html = renderToString(
      <LogTableBody
        rows={[row({ requestId: "cf-ray-abc" })]}
        complete={true}
        loadMoreAction="/admin/logs"
      />,
    );
    expect(html).toContain("cf-ray-abc");
  });

  it("renders a load-more button when not complete and cursor is present", () => {
    const html = renderToString(
      <LogTableBody
        rows={[row()]}
        complete={false}
        cursor="next-page-cursor"
        loadMoreAction="/admin/logs"
      />,
    );
    expect(html).toContain("Load more");
    expect(html).toContain("cursor=next-page-cursor");
  });

  it("omits the load-more button when complete", () => {
    const html = renderToString(
      <LogTableBody rows={[row()]} complete={true} cursor="some-cursor" loadMoreAction="/admin/logs" />,
    );
    expect(html).not.toContain("Load more");
  });

  it("renders the id attribute on tbody when provided", () => {
    const html = renderToString(
      <LogTableBody id="log-tbody" rows={[]} complete={true} loadMoreAction="/admin/logs" />,
    );
    expect(html).toContain('<tbody id="log-tbody">');
  });
});

describe("LogFilterBar", () => {
  it("renders the level select and search input", () => {
    const html = renderToString(
      <LogFilterBar targetId="log-tbody" formAction="/admin/logs" icon={icon} />,
    );
    expect(html).toContain('name="level"');
    expect(html).toContain('name="q"');
    expect(html).toContain("hx-get");
    expect(html).toContain('hx-swap="outerHTML"');
  });

  it("pre-selects the current level", () => {
    const html = renderToString(
      <LogFilterBar level="error" targetId="log-tbody" formAction="/admin/logs" icon={icon} />,
    );
    expect(html).toContain('value="error" selected');
  });

  it("pre-fills the search query", () => {
    const html = renderToString(
      <LogFilterBar q="payment" targetId="log-tbody" formAction="/admin/logs" icon={icon} />,
    );
    expect(html).toContain('value="payment"');
  });
});
