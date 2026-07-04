import { describe, expect, it } from "bun:test";
import { renderToString } from "../../jsx/render-to-string";
import { createIcon } from "../../ui/core/icon";
import type { LogRecord, LogRow } from "../types";
import { LogDetailCell, LogFilterBar, LogLevelBadge, LogTableBody } from "./components";

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
  it("renders the level text", async () => {
    const html = String(await renderToString(<LogLevelBadge level='warn' />));
    expect(html).toBe(
      '<span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide bg-amber-100 text-amber-700">warn</span>',
    );
  });

  it("renders error variant", async () => {
    const html = String(await renderToString(<LogLevelBadge level='error' />));
    expect(html).toContain("bg-red-100 text-red-700");
    expect(html).toContain("error");
  });

  it("renders debug variant", async () => {
    const html = String(await renderToString(<LogLevelBadge level='debug' />));
    expect(html).toContain("bg-brand-100 text-brand-600");
  });

  it("falls back to info style for unknown levels", async () => {
    const html = String(await renderToString(<LogLevelBadge level='unknown' />));
    expect(html).toContain("bg-blue-100 text-blue-700");
  });
});

describe("LogTableBody", () => {
  it("renders an empty-state row when rows is empty", async () => {
    const html = String(await renderToString(<LogTableBody rows={[]} complete={true} loadMoreAction='/admin/logs' />));
    expect(html).toContain("No log entries found.");
  });

  it("renders a row for each log entry", async () => {
    const rows: LogRow[] = [row({ message: "first event" }), row({ message: "second event", level: "error" })];
    const html = String(await renderToString(<LogTableBody rows={rows} complete={true} loadMoreAction='/admin/logs' />));
    expect(html).toContain("first event");
    expect(html).toContain("second event");
  });

  it("renders — when requestId is absent", async () => {
    const html = String(await renderToString(<LogTableBody rows={[row()]} complete={true} loadMoreAction='/admin/logs' />));
    // The renderer emits the em-dash as the literal character, not an HTML entity.
    expect(html).toContain("—");
  });

  it("renders requestId when present", async () => {
    const html = String(
      await renderToString(<LogTableBody rows={[row({ requestId: "cf-ray-abc" })]} complete={true} loadMoreAction='/admin/logs' />),
    );
    expect(html).toContain("cf-ray-abc");
  });

  it("renders a load-more button when not complete and cursor is present", async () => {
    const html = String(
      await renderToString(<LogTableBody rows={[row()]} complete={false} cursor='next-page-cursor' loadMoreAction='/admin/logs' />),
    );
    expect(html).toContain("Load more");
    expect(html).toContain("cursor=next-page-cursor");
  });

  it("omits the load-more button when complete", async () => {
    const html = String(await renderToString(<LogTableBody rows={[row()]} complete={true} cursor='some-cursor' loadMoreAction='/admin/logs' />));
    expect(html).not.toContain("Load more");
  });

  it("renders the id attribute on tbody when provided", async () => {
    const html = String(await renderToString(<LogTableBody id='log-tbody' rows={[]} complete={true} loadMoreAction='/admin/logs' />));
    expect(html).toContain('<tbody id="log-tbody">');
  });
});

describe("LogTableBody — detail toggle", () => {
  it("the message cell issues an hx-get for the row's detail", async () => {
    const html = String(await renderToString(<LogTableBody rows={[row()]} complete={true} loadMoreAction='/admin/logs' />));
    expect(html).toContain(`hx-get="/admin/logs?detail=${encodeURIComponent(row().key)}"`);
    expect(html).toContain('hx-target="closest td"');
  });

  it("URL-encodes the row key in the detail link", async () => {
    const html = String(
      await renderToString(
        <LogTableBody rows={[row({ key: "logs||2026-05-31T10:00:00.000Z||x" })]} complete={true} loadMoreAction='/admin/logs' />,
      ),
    );
    expect(html).toContain("detail=logs%7C%7C2026-05-31T10%3A00%3A00.000Z%7C%7Cx");
  });
});

describe("LogDetailCell", () => {
  const record: LogRecord = {
    level: "error",
    prefix: "client",
    message: "uncaught",
    timestamp: "2026-05-31T10:00:00.000Z",
    data: { stack: "Error: boom\n  at main.ts:1" },
  };

  it("renders the full record as pretty-printed JSON including the stack", async () => {
    const html = String(await renderToString(<LogDetailCell record={record} />));
    expect(html).toContain("<pre");
    expect(html).toContain("uncaught");
    expect(html).toContain("main.ts:1");
  });

  it("renders a not-found message for a null record", async () => {
    const html = String(await renderToString(<LogDetailCell record={null} />));
    expect(html).toContain("Log entry not found or expired.");
    expect(html).not.toContain("<pre");
  });
});

describe("LogFilterBar", () => {
  it("renders the level select and search input", async () => {
    const html = String(await renderToString(<LogFilterBar targetId='log-tbody' formAction='/admin/logs' icon={icon} />));
    expect(html).toContain('name="level"');
    expect(html).toContain('name="q"');
    expect(html).toContain("hx-get");
    expect(html).toContain('hx-swap="outerHTML"');
  });

  it("pre-selects the current level", async () => {
    const html = String(await renderToString(<LogFilterBar level='error' targetId='log-tbody' formAction='/admin/logs' icon={icon} />));
    expect(html).toContain('value="error" selected');
  });

  it("pre-fills the search query", async () => {
    const html = String(await renderToString(<LogFilterBar q='payment' targetId='log-tbody' formAction='/admin/logs' icon={icon} />));
    expect(html).toContain('value="payment"');
  });
});
