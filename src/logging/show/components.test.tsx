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
    expect(html).toBe(
      '<span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide bg-red-100 text-red-700">error</span>',
    );
  });

  it("renders debug variant", async () => {
    const html = String(await renderToString(<LogLevelBadge level='debug' />));
    expect(html).toBe(
      '<span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide bg-brand-100 text-brand-600">debug</span>',
    );
  });

  it("falls back to info style for unknown levels", async () => {
    const html = String(await renderToString(<LogLevelBadge level='unknown' />));
    expect(html).toBe(
      '<span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide bg-blue-100 text-blue-700">unknown</span>',
    );
  });
});

describe("LogTableBody", () => {
  it("renders an empty-state row when rows is empty", async () => {
    const html = String(await renderToString(<LogTableBody rows={[]} complete={true} loadMoreAction='/admin/logs' />));
    expect(html).toBe('<tbody><tr><td colspan="5" class="py-8 text-center text-brand-500 text-sm">No log entries found.</td></tr></tbody>');
  });

  it("renders a row for each log entry", async () => {
    const rows: LogRow[] = [row({ message: "first event" }), row({ message: "second event", level: "error" })];
    const html = String(await renderToString(<LogTableBody rows={rows} complete={true} loadMoreAction='/admin/logs' />));
    expect(html).toBe(
      '<tbody><tr class="border-b border-brand-100 hover:bg-brand-50"><td class="py-2 pl-4 pr-4 font-mono text-xs text-brand-600 whitespace-nowrap">2026-05-31T10:00:00.000Z</td><td class="py-2 pr-4"><span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide bg-blue-100 text-blue-700">info</span></td><td class="py-2 pr-4 font-mono text-xs text-brand-700">svc</td><td class="py-2 pr-4 max-w-xs truncate text-brand-900"><button type="button" class="cursor-pointer text-left hover:underline" hx-get="/admin/logs?detail=logs%7C%7C2026-05-31T10%3A00%3A00.000Z%7C%7Caaa" hx-target="closest td" hx-swap="outerHTML">first event</button></td><td class="py-2 pr-4 font-mono text-xs text-brand-500">—</td></tr><tr class="border-b border-brand-100 hover:bg-brand-50"><td class="py-2 pl-4 pr-4 font-mono text-xs text-brand-600 whitespace-nowrap">2026-05-31T10:00:00.000Z</td><td class="py-2 pr-4"><span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide bg-red-100 text-red-700">error</span></td><td class="py-2 pr-4 font-mono text-xs text-brand-700">svc</td><td class="py-2 pr-4 max-w-xs truncate text-brand-900"><button type="button" class="cursor-pointer text-left hover:underline" hx-get="/admin/logs?detail=logs%7C%7C2026-05-31T10%3A00%3A00.000Z%7C%7Caaa" hx-target="closest td" hx-swap="outerHTML">second event</button></td><td class="py-2 pr-4 font-mono text-xs text-brand-500">—</td></tr></tbody>',
    );
  });

  it("renders — when requestId is absent", async () => {
    const html = String(await renderToString(<LogTableBody rows={[row()]} complete={true} loadMoreAction='/admin/logs' />));
    // The renderer emits the em-dash as the literal character, not an HTML entity.
    expect(html).toBe(
      '<tbody><tr class="border-b border-brand-100 hover:bg-brand-50"><td class="py-2 pl-4 pr-4 font-mono text-xs text-brand-600 whitespace-nowrap">2026-05-31T10:00:00.000Z</td><td class="py-2 pr-4"><span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide bg-blue-100 text-blue-700">info</span></td><td class="py-2 pr-4 font-mono text-xs text-brand-700">svc</td><td class="py-2 pr-4 max-w-xs truncate text-brand-900"><button type="button" class="cursor-pointer text-left hover:underline" hx-get="/admin/logs?detail=logs%7C%7C2026-05-31T10%3A00%3A00.000Z%7C%7Caaa" hx-target="closest td" hx-swap="outerHTML">test message</button></td><td class="py-2 pr-4 font-mono text-xs text-brand-500">—</td></tr></tbody>',
    );
  });

  it("renders requestId when present", async () => {
    const html = String(
      await renderToString(<LogTableBody rows={[row({ requestId: "cf-ray-abc" })]} complete={true} loadMoreAction='/admin/logs' />),
    );
    expect(html).toBe(
      '<tbody><tr class="border-b border-brand-100 hover:bg-brand-50"><td class="py-2 pl-4 pr-4 font-mono text-xs text-brand-600 whitespace-nowrap">2026-05-31T10:00:00.000Z</td><td class="py-2 pr-4"><span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide bg-blue-100 text-blue-700">info</span></td><td class="py-2 pr-4 font-mono text-xs text-brand-700">svc</td><td class="py-2 pr-4 max-w-xs truncate text-brand-900"><button type="button" class="cursor-pointer text-left hover:underline" hx-get="/admin/logs?detail=logs%7C%7C2026-05-31T10%3A00%3A00.000Z%7C%7Caaa" hx-target="closest td" hx-swap="outerHTML">test message</button></td><td class="py-2 pr-4 font-mono text-xs text-brand-500">cf-ray-abc</td></tr></tbody>',
    );
  });

  it("renders a load-more button when not complete and cursor is present", async () => {
    const html = String(
      await renderToString(<LogTableBody rows={[row()]} complete={false} cursor='next-page-cursor' loadMoreAction='/admin/logs' />),
    );
    expect(html).toBe(
      '<tbody><tr class="border-b border-brand-100 hover:bg-brand-50"><td class="py-2 pl-4 pr-4 font-mono text-xs text-brand-600 whitespace-nowrap">2026-05-31T10:00:00.000Z</td><td class="py-2 pr-4"><span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide bg-blue-100 text-blue-700">info</span></td><td class="py-2 pr-4 font-mono text-xs text-brand-700">svc</td><td class="py-2 pr-4 max-w-xs truncate text-brand-900"><button type="button" class="cursor-pointer text-left hover:underline" hx-get="/admin/logs?detail=logs%7C%7C2026-05-31T10%3A00%3A00.000Z%7C%7Caaa" hx-target="closest td" hx-swap="outerHTML">test message</button></td><td class="py-2 pr-4 font-mono text-xs text-brand-500">—</td></tr><tr><td colspan="5" class="py-4 text-center"><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm" hx-get="/admin/logs?cursor=next-page-cursor" hx-target="closest tbody" hx-swap="outerHTML">Load more</button></td></tr></tbody>',
    );
  });

  it("omits the load-more button when complete", async () => {
    const html = String(await renderToString(<LogTableBody rows={[row()]} complete={true} cursor='some-cursor' loadMoreAction='/admin/logs' />));
    expect(html).toBe(
      '<tbody><tr class="border-b border-brand-100 hover:bg-brand-50"><td class="py-2 pl-4 pr-4 font-mono text-xs text-brand-600 whitespace-nowrap">2026-05-31T10:00:00.000Z</td><td class="py-2 pr-4"><span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide bg-blue-100 text-blue-700">info</span></td><td class="py-2 pr-4 font-mono text-xs text-brand-700">svc</td><td class="py-2 pr-4 max-w-xs truncate text-brand-900"><button type="button" class="cursor-pointer text-left hover:underline" hx-get="/admin/logs?detail=logs%7C%7C2026-05-31T10%3A00%3A00.000Z%7C%7Caaa" hx-target="closest td" hx-swap="outerHTML">test message</button></td><td class="py-2 pr-4 font-mono text-xs text-brand-500">—</td></tr></tbody>',
    );
  });

  it("renders the id attribute on tbody when provided", async () => {
    const html = String(await renderToString(<LogTableBody id='log-tbody' rows={[]} complete={true} loadMoreAction='/admin/logs' />));
    expect(html).toBe(
      '<tbody id="log-tbody"><tr><td colspan="5" class="py-8 text-center text-brand-500 text-sm">No log entries found.</td></tr></tbody>',
    );
  });
});

describe("LogTableBody — detail toggle", () => {
  it("the message cell issues an hx-get for the row's detail", async () => {
    const html = String(await renderToString(<LogTableBody rows={[row()]} complete={true} loadMoreAction='/admin/logs' />));
    expect(html).toBe(
      '<tbody><tr class="border-b border-brand-100 hover:bg-brand-50"><td class="py-2 pl-4 pr-4 font-mono text-xs text-brand-600 whitespace-nowrap">2026-05-31T10:00:00.000Z</td><td class="py-2 pr-4"><span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide bg-blue-100 text-blue-700">info</span></td><td class="py-2 pr-4 font-mono text-xs text-brand-700">svc</td><td class="py-2 pr-4 max-w-xs truncate text-brand-900"><button type="button" class="cursor-pointer text-left hover:underline" hx-get="/admin/logs?detail=logs%7C%7C2026-05-31T10%3A00%3A00.000Z%7C%7Caaa" hx-target="closest td" hx-swap="outerHTML">test message</button></td><td class="py-2 pr-4 font-mono text-xs text-brand-500">—</td></tr></tbody>',
    );
  });

  it("URL-encodes the row key in the detail link", async () => {
    const html = String(
      await renderToString(
        <LogTableBody rows={[row({ key: "logs||2026-05-31T10:00:00.000Z||x" })]} complete={true} loadMoreAction='/admin/logs' />,
      ),
    );
    expect(html).toBe(
      '<tbody><tr class="border-b border-brand-100 hover:bg-brand-50"><td class="py-2 pl-4 pr-4 font-mono text-xs text-brand-600 whitespace-nowrap">2026-05-31T10:00:00.000Z</td><td class="py-2 pr-4"><span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide bg-blue-100 text-blue-700">info</span></td><td class="py-2 pr-4 font-mono text-xs text-brand-700">svc</td><td class="py-2 pr-4 max-w-xs truncate text-brand-900"><button type="button" class="cursor-pointer text-left hover:underline" hx-get="/admin/logs?detail=logs%7C%7C2026-05-31T10%3A00%3A00.000Z%7C%7Cx" hx-target="closest td" hx-swap="outerHTML">test message</button></td><td class="py-2 pr-4 font-mono text-xs text-brand-500">—</td></tr></tbody>',
    );
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
    expect(html).toBe(
      '<td class="py-2 pr-4 text-brand-900"><pre class="max-w-2xl overflow-x-auto whitespace-pre-wrap break-all rounded bg-brand-50 p-2 font-mono text-xs text-brand-800">{\n  &quot;level&quot;: &quot;error&quot;,\n  &quot;prefix&quot;: &quot;client&quot;,\n  &quot;message&quot;: &quot;uncaught&quot;,\n  &quot;timestamp&quot;: &quot;2026-05-31T10:00:00.000Z&quot;,\n  &quot;data&quot;: {\n    &quot;stack&quot;: &quot;Error: boom\\n  at main.ts:1&quot;\n  }\n}</pre></td>',
    );
  });

  it("renders a not-found message for a null record", async () => {
    const html = String(await renderToString(<LogDetailCell record={null} />));
    expect(html).toBe('<td class="py-2 pr-4 text-brand-900"><span class="text-sm text-brand-500">Log entry not found or expired.</span></td>');
  });
});

describe("LogFilterBar", () => {
  it("renders the level select and search input", async () => {
    const html = String(await renderToString(<LogFilterBar targetId='log-tbody' formAction='/admin/logs' icon={icon} />));
    expect(html).toBe(
      '<form class="flex flex-wrap sm:flex-nowrap items-end gap-3" hx-get="/admin/logs" hx-target="#log-tbody" hx-swap="outerHTML" hx-push-url="true"><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 min-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-q">Search</label><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" name="q" type="search" placeholder="message, prefix, requestId…" value="" id="field-q" aria-describedby="field-q-description"></fieldset><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 max-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-level">Level</label><div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" name="level" id="field-level" aria-describedby="field-level-description"><option data-slot="select-option" value="" selected>All</option><option data-slot="select-option" value="debug">debug</option><option data-slot="select-option" value="info">info</option><option data-slot="select-option" value="warn">warn</option><option data-slot="select-option" value="error">error</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div></fieldset><button type="submit" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent h-10 px-4 text-sm">Filter</button></form>',
    );
  });

  it("pre-selects the current level", async () => {
    const html = String(await renderToString(<LogFilterBar level='error' targetId='log-tbody' formAction='/admin/logs' icon={icon} />));
    expect(html).toBe(
      '<form class="flex flex-wrap sm:flex-nowrap items-end gap-3" hx-get="/admin/logs" hx-target="#log-tbody" hx-swap="outerHTML" hx-push-url="true"><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 min-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-q">Search</label><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" name="q" type="search" placeholder="message, prefix, requestId…" value="" id="field-q" aria-describedby="field-q-description"></fieldset><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 max-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-level">Level</label><div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" name="level" id="field-level" aria-describedby="field-level-description"><option data-slot="select-option" value="">All</option><option data-slot="select-option" value="debug">debug</option><option data-slot="select-option" value="info">info</option><option data-slot="select-option" value="warn">warn</option><option data-slot="select-option" value="error" selected>error</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div></fieldset><button type="submit" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent h-10 px-4 text-sm">Filter</button></form>',
    );
  });

  it("pre-fills the search query", async () => {
    const html = String(await renderToString(<LogFilterBar q='payment' targetId='log-tbody' formAction='/admin/logs' icon={icon} />));
    expect(html).toBe(
      '<form class="flex flex-wrap sm:flex-nowrap items-end gap-3" hx-get="/admin/logs" hx-target="#log-tbody" hx-swap="outerHTML" hx-push-url="true"><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 min-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-q">Search</label><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" name="q" type="search" placeholder="message, prefix, requestId…" value="payment" id="field-q" aria-describedby="field-q-description"></fieldset><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 max-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-level">Level</label><div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" name="level" id="field-level" aria-describedby="field-level-description"><option data-slot="select-option" value="" selected>All</option><option data-slot="select-option" value="debug">debug</option><option data-slot="select-option" value="info">info</option><option data-slot="select-option" value="warn">warn</option><option data-slot="select-option" value="error">error</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div></fieldset><button type="submit" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent h-10 px-4 text-sm">Filter</button></form>',
    );
  });
});
