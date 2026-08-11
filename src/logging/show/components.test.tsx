/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { createIcon } from "../../ui/core/icon";
import type { LogRecord, LogRow } from "../types";
import {
  LOG_LOAD_MORE_ID,
  LOG_TBODY_ID,
  LogAppendFragment,
  LogDetailRow,
  LogFilterBar,
  LogLevelBadge,
  LogLoadMoreRow,
  LogRows,
  LogTable,
  LogTableBody,
  LogViewerContent,
} from "./components";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });

const ROW_A: LogRow = {
  key: "logs||2026-05-31T10:00:00.000Z||aaa",
  level: "info",
  prefix: "svc",
  message: "first event",
  timestamp: "2026-05-31T10:00:00.000Z",
};

/** Carries a `requestId`, an escaping-sensitive message, and a different key, so the second row of a
 *  page is never a copy of the first. */
const ROW_B: LogRow = {
  key: "logs||2026-05-31T10:00:01.000Z||bbb",
  level: "error",
  prefix: "api",
  requestId: "req-7",
  message: "Tom & Co <script>",
  timestamp: "2026-05-31T10:00:01.000Z",
};

// The two `<tr>`s one row renders — the data row and the detail row it controls. Stated once so the
// composite assertions below (`LogTableBody`, `LogAppendFragment`) read as composition rather than as
// another wall of markup, and so a change to the pair fails in one place.
const ROW_A_HTML =
  '<tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs tabular-nums whitespace-nowrap text-muted-foreground">2026-05-31T10:00:00.000Z</td><td class="py-2 pr-4"><span data-slot="badge" data-variant="info" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-status-info-strong text-status-info-strong-foreground border-status-info-border">info</span></td><td class="py-2 pr-4 font-mono text-xs text-muted-foreground">svc</td><td class="py-2 pr-4 max-w-xs truncate text-foreground"><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm" aria-expanded="false" aria-controls="log-detail-logs--2026-05-31T10-00-00-000Z--aaa" hx-get="/admin/logs?detail=logs%7C%7C2026-05-31T10%3A00%3A00.000Z%7C%7Caaa" hx-target="#log-detail-logs--2026-05-31T10-00-00-000Z--aaa" hx-swap="outerHTML" hx-indicator="#log-detail-logs--2026-05-31T10-00-00-000Z--aaa" hx-disabled-elt="this">first event</button></td><td class="py-2 pr-4 font-mono text-xs text-muted-foreground">—</td></tr><tr id="log-detail-logs--2026-05-31T10-00-00-000Z--aaa" class="hidden border-b border-border [&amp;.htmx-request]:table-row"><td colspan="5" class="px-4 py-2"><span class="sr-only">Loading log entry detail…</span><div data-slot="skeleton" aria-hidden="true" class="animate-pulse rounded-md bg-muted h-4 w-full"></div></td></tr>';

const ROW_B_HTML =
  '<tr class="border-b border-border hover:bg-accent"><td class="py-2 pl-4 pr-4 font-mono text-xs tabular-nums whitespace-nowrap text-muted-foreground">2026-05-31T10:00:01.000Z</td><td class="py-2 pr-4"><span data-slot="badge" data-variant="destructive" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-status-danger-strong text-status-danger-strong-foreground border-status-danger-border">error</span></td><td class="py-2 pr-4 font-mono text-xs text-muted-foreground">api</td><td class="py-2 pr-4 max-w-xs truncate text-foreground"><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm" aria-expanded="false" aria-controls="log-detail-logs--2026-05-31T10-00-01-000Z--bbb" hx-get="/admin/logs?detail=logs%7C%7C2026-05-31T10%3A00%3A01.000Z%7C%7Cbbb" hx-target="#log-detail-logs--2026-05-31T10-00-01-000Z--bbb" hx-swap="outerHTML" hx-indicator="#log-detail-logs--2026-05-31T10-00-01-000Z--bbb" hx-disabled-elt="this">Tom &amp; Co &lt;script&gt;</button></td><td class="py-2 pr-4 font-mono text-xs text-muted-foreground">req-7</td></tr><tr id="log-detail-logs--2026-05-31T10-00-01-000Z--bbb" class="hidden border-b border-border [&amp;.htmx-request]:table-row"><td colspan="5" class="px-4 py-2"><span class="sr-only">Loading log entry detail…</span><div data-slot="skeleton" aria-hidden="true" class="animate-pulse rounded-md bg-muted h-4 w-full"></div></td></tr>';

const ERROR_ROW_HTML =
  '<tr><td colspan="5" class="px-4 py-4"><div data-slot="alert" data-variant="destructive" class="relative rounded-2xl border px-4 py-3 text-sm border-status-danger-border bg-status-danger-subtle text-status-danger-subtle-foreground flex flex-col items-start gap-2"><div data-slot="alert-title" class="font-medium leading-none tracking-tight">Could not read the log stream</div><div data-slot="alert-description" class="text-sm leading-relaxed opacity-90">The channel did not answer. Entries already loaded are still shown below.</div><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent h-8 px-3 text-sm" hx-get="/admin/logs" hx-target="#log-tbody" hx-swap="outerHTML" hx-indicator="this" hx-disabled-elt="this">Retry</button></div></td></tr>';

const EMPTY_UNFILTERED_ROW_HTML =
  '<tr><td colspan="5" class="px-4 py-4 text-center"><div class="flex flex-col items-center gap-2"><span class="text-sm text-muted-foreground">No log entries have been recorded yet.</span></div></td></tr>';

const EMPTY_FILTERED_ROW_HTML =
  '<tr><td colspan="5" class="px-4 py-4 text-center"><div class="flex flex-col items-center gap-2"><span class="text-sm text-muted-foreground">No log entries match these filters — the stream itself may not be empty.</span><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent h-8 px-3 text-sm" hx-get="/admin/logs" hx-target="#log-tbody" hx-swap="outerHTML" hx-indicator="this" hx-disabled-elt="this" hx-push-url="/admin/logs">Clear filters</button></div></td></tr>';

const FILTER_BAR_UNFILTERED_HTML =
  '<form class="flex flex-wrap sm:flex-nowrap items-end gap-2" hx-get="/admin/logs" hx-target="#log-tbody" hx-swap="outerHTML" hx-indicator="#log-tbody" hx-disabled-elt="find button[type=&#39;submit&#39;]" hx-push-url="true"><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-destructive flex-col [&amp;&gt;*]:w-full flex-1 min-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled]/field:opacity-50" for="field-q">Search</label><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" name="q" type="search" placeholder="message, prefix, requestId…" value="" id="field-q"></fieldset><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-destructive flex-col [&amp;&gt;*]:w-full flex-1 max-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled]/field:opacity-50" for="field-level">Level</label><div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" name="level" id="field-level"><option data-slot="select-option" value="" selected>All</option><option data-slot="select-option" value="debug">debug</option><option data-slot="select-option" value="info">info</option><option data-slot="select-option" value="warn">warn</option><option data-slot="select-option" value="error">error</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div></fieldset><button type="submit" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3 text-sm">Filter</button></form>';

const THEAD_HTML =
  '<thead><tr class="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"><th class="py-2 pl-4 pr-4 whitespace-nowrap">Timestamp</th><th class="py-2 pr-4">Level</th><th class="py-2 pr-4">Prefix</th><th class="py-2 pr-4 max-w-xs">Message</th><th class="py-2 pr-4">Request ID</th></tr></thead>';

describe("LOG_TBODY_ID / LOG_LOAD_MORE_ID", () => {
  it("are the ids every fragment and swap target names", () => {
    expect({ tbody: LOG_TBODY_ID, loadMore: LOG_LOAD_MORE_ID }).toEqual({ tbody: "log-tbody", loadMore: "log-load-more" });
  });
});

// ── LogLevelBadge ─────────────────────────────────────────────────────────────────────────────

describe("LogLevelBadge", () => {
  it("renders error as the destructive badge", async () => {
    expect(await render(<LogLevelBadge level='error' />)).toBe(
      '<span data-slot="badge" data-variant="destructive" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-status-danger-strong text-status-danger-strong-foreground border-status-danger-border">error</span>',
    );
  });

  it("renders warn as the warning badge", async () => {
    expect(await render(<LogLevelBadge level='warn' />)).toBe(
      '<span data-slot="badge" data-variant="warning" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-status-warning-strong text-status-warning-strong-foreground border-status-warning-border">warn</span>',
    );
  });

  it("renders info as the info badge", async () => {
    expect(await render(<LogLevelBadge level='info' />)).toBe(
      '<span data-slot="badge" data-variant="info" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-status-info-strong text-status-info-strong-foreground border-status-info-border">info</span>',
    );
  });

  it("renders debug as the outline badge — a neutral label, not a status hue", async () => {
    expect(await render(<LogLevelBadge level='debug' />)).toBe(
      '<span data-slot="badge" data-variant="outline" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors border-border text-foreground">debug</span>',
    );
  });

  it("falls back to info for an unknown level, keeping the level word as the badge's own content", async () => {
    expect(await render(<LogLevelBadge level='fatal' />)).toBe(
      '<span data-slot="badge" data-variant="info" class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors bg-status-info-strong text-status-info-strong-foreground border-status-info-border">fatal</span>',
    );
  });
});

// ── LogFilterBar ──────────────────────────────────────────────────────────────────────────────

describe("LogFilterBar", () => {
  it("renders the unfiltered form — All selected, empty search, the tbody as the indicator", async () => {
    expect(await render(<LogFilterBar targetId={LOG_TBODY_ID} formAction='/admin/logs' icon={icon} />)).toBe(FILTER_BAR_UNFILTERED_HTML);
  });

  it("pre-selects the level and escapes the search value it echoes back", async () => {
    expect(await render(<LogFilterBar level='error' q="Tom & O'Brien" targetId={LOG_TBODY_ID} formAction='/admin/logs' icon={icon} />)).toBe(
      '<form class="flex flex-wrap sm:flex-nowrap items-end gap-2" hx-get="/admin/logs" hx-target="#log-tbody" hx-swap="outerHTML" hx-indicator="#log-tbody" hx-disabled-elt="find button[type=&#39;submit&#39;]" hx-push-url="true"><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-destructive flex-col [&amp;&gt;*]:w-full flex-1 min-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled]/field:opacity-50" for="field-q">Search</label><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" name="q" type="search" placeholder="message, prefix, requestId…" value="Tom &amp; O&#39;Brien" id="field-q"></fieldset><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-destructive flex-col [&amp;&gt;*]:w-full flex-1 max-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled]/field:opacity-50" for="field-level">Level</label><div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" name="level" id="field-level"><option data-slot="select-option" value="">All</option><option data-slot="select-option" value="debug">debug</option><option data-slot="select-option" value="info">info</option><option data-slot="select-option" value="warn">warn</option><option data-slot="select-option" value="error" selected>error</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div></fieldset><button type="submit" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3 text-sm">Filter</button></form>',
    );
  });
});

// ── LogLoadMoreRow ────────────────────────────────────────────────────────────────────────────

describe("LogLoadMoreRow", () => {
  it("renders the control appending into the tbody it sits outside of", async () => {
    expect(await render(<LogLoadMoreRow cursor='c1' complete={false} loadMoreAction='/admin/logs' />)).toBe(
      '<tr id="log-load-more"><td colspan="5" class="px-4 py-2 text-center"><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm" hx-get="/admin/logs?cursor=c1" hx-target="#log-tbody" hx-swap="beforeend" hx-indicator="this" hx-disabled-elt="this">Load more</button></td></tr>',
    );
  });

  it("keeps the row but drops the control once the stream is complete", async () => {
    expect(await render(<LogLoadMoreRow cursor='c1' complete={true} loadMoreAction='/admin/logs' />)).toBe(
      '<tr id="log-load-more"><td colspan="5" class="px-4 py-2 text-center"></td></tr>',
    );
  });

  it("drops the control when no cursor was issued, however incomplete the read claims to be", async () => {
    expect(await render(<LogLoadMoreRow complete={false} loadMoreAction='/admin/logs' />)).toBe(
      '<tr id="log-load-more"><td colspan="5" class="px-4 py-2 text-center"></td></tr>',
    );
  });

  it("becomes its own retry when the read failed — the Alert above it, and Try again on the same cursor", async () => {
    // The cursor was never consumed, so the control keeps it: there is no second control to keep in
    // step, and the reader is never left with the button gone and no way back.
    expect(await render(<LogLoadMoreRow cursor='c1' complete={false} loadMoreAction='/admin/logs' failed={true} />)).toBe(
      '<tr id="log-load-more"><td colspan="5" class="px-4 py-2 text-center"><div data-slot="alert" data-variant="destructive" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-status-danger-border bg-status-danger-subtle text-status-danger-subtle-foreground mb-2 text-left"><div data-slot="alert-title" class="font-medium leading-none tracking-tight">Could not load the next page</div><div data-slot="alert-description" class="text-sm leading-relaxed opacity-90">The channel did not answer. The entries already loaded are unaffected.</div></div><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm" hx-get="/admin/logs?cursor=c1" hx-target="#log-tbody" hx-swap="beforeend" hx-indicator="this" hx-disabled-elt="this">Try again</button></td></tr>',
    );
  });

  it("carries the active filters into the next-page URL, so page two is drawn from the same set", async () => {
    expect(await render(<LogLoadMoreRow cursor='c1' complete={false} loadMoreAction='/admin/logs' level='error' q='pay ment' />)).toBe(
      '<tr id="log-load-more"><td colspan="5" class="px-4 py-2 text-center"><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm" hx-get="/admin/logs?cursor=c1&amp;level=error&amp;q=pay+ment" hx-target="#log-tbody" hx-swap="beforeend" hx-indicator="this" hx-disabled-elt="this">Load more</button></td></tr>',
    );
  });
});

// ── LogRows ───────────────────────────────────────────────────────────────────────────────────

describe("LogRows", () => {
  it("wires the message trigger to its sibling detail row — never to its own cell", async () => {
    // `aria-expanded` / `aria-controls` name the detail row, and `hx-target` is that same
    // `<tr id="log-detail-…">` rather than the `<td>` holding the button: a swap over the trigger's
    // own cell destroys the trigger. The key's `|` and `:` are percent-encoded in the detail URL and
    // folded to `-` in the id.
    expect(await render(<LogRows rows={[ROW_A]} loadMoreAction='/admin/logs' />)).toBe(ROW_A_HTML);
  });

  it("renders one pair per row, escaping the message and showing the requestId when present", async () => {
    expect(await render(<LogRows rows={[ROW_A, ROW_B]} loadMoreAction='/admin/logs' />)).toBe(`${ROW_A_HTML}${ROW_B_HTML}`);
  });
});

// ── LogTableBody ──────────────────────────────────────────────────────────────────────────────

describe("LogTableBody — empty states", () => {
  it("says nothing has been recorded, with no clear-filters control, when no filter is active", async () => {
    expect(await render(<LogTableBody rows={[]} loadMoreAction='/admin/logs' />)).toBe(`<tbody>${EMPTY_UNFILTERED_ROW_HTML}</tbody>`);
  });

  it("says the filters matched nothing, and offers a clear-filters control, when a level is active", async () => {
    expect(await render(<LogTableBody rows={[]} loadMoreAction='/admin/logs' level='error' />)).toBe(`<tbody>${EMPTY_FILTERED_ROW_HTML}</tbody>`);
  });

  it("treats a search term alone as the filtered flavour", async () => {
    expect(await render(<LogTableBody rows={[]} loadMoreAction='/admin/logs' q='pay' />)).toBe(`<tbody>${EMPTY_FILTERED_ROW_HTML}</tbody>`);
  });
});

describe("LogTableBody — rows and the error state", () => {
  it("carries the id it is given and the rows it is handed", async () => {
    expect(await render(<LogTableBody id={LOG_TBODY_ID} rows={[ROW_A]} loadMoreAction='/admin/logs' />)).toBe(
      `<tbody id="log-tbody">${ROW_A_HTML}</tbody>`,
    );
  });

  it("renders the destructive Alert with a retry Button in place of the empty state when the read failed", async () => {
    expect(await render(<LogTableBody rows={[]} loadMoreAction='/admin/logs' failed={true} />)).toBe(`<tbody>${ERROR_ROW_HTML}</tbody>`);
  });

  it("keeps the rows already loaded beside the error, and points the retry at the active filters", async () => {
    expect(await render(<LogTableBody id={LOG_TBODY_ID} rows={[ROW_A]} loadMoreAction='/admin/logs' level='error' q='pay' failed={true} />)).toBe(
      `<tbody id="log-tbody">${ERROR_ROW_HTML.replace('hx-get="/admin/logs"', 'hx-get="/admin/logs?level=error&amp;q=pay"')}${ROW_A_HTML}</tbody>`,
    );
  });
});

// ── LogTable ──────────────────────────────────────────────────────────────────────────────────

describe("LogTable", () => {
  it("renders thead, the tbody it is given an id for, and the load-more row in a tfoot", async () => {
    expect(
      await render(<LogTable rows={[]} cursor='c1' complete={false} loadMoreAction='/admin/logs' tbodyId={LOG_TBODY_ID} level='error' />),
    ).toBe(
      `<table class="w-full border-collapse text-sm">${THEAD_HTML}<tbody id="log-tbody">${EMPTY_FILTERED_ROW_HTML}</tbody><tfoot><tr id="log-load-more"><td colspan="5" class="px-4 py-2 text-center"><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm" hx-get="/admin/logs?cursor=c1&amp;level=error" hx-target="#log-tbody" hx-swap="beforeend" hx-indicator="this" hx-disabled-elt="this">Load more</button></td></tr></tfoot></table>`,
    );
  });
});

// ── LogAppendFragment ─────────────────────────────────────────────────────────────────────────

// Two consecutive pages. The control the first response ships carries `cursor-2`; the second
// response replaces that same `#log-load-more` out of band with one carrying `cursor-3`. Without the
// out-of-band half, the control would keep pointing at a cursor already consumed.
describe("LogAppendFragment", () => {
  it("ships the first page's rows plus an out-of-band load-more row carrying the next cursor", async () => {
    expect(await render(<LogAppendFragment data={{ rows: [ROW_A], cursor: "cursor-2", complete: false, basePath: "/admin/logs" }} />)).toBe(
      `${ROW_A_HTML}<tr id="log-load-more" hx-swap-oob="outerHTML:#log-load-more"><td colspan="5" class="px-4 py-2 text-center"><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm" hx-get="/admin/logs?cursor=cursor-2" hx-target="#log-tbody" hx-swap="beforeend" hx-indicator="this" hx-disabled-elt="this">Load more</button></td></tr>`,
    );
  });

  it("replaces that control on the following page with one carrying the NEW cursor and the filters", async () => {
    expect(
      await render(<LogAppendFragment data={{ rows: [ROW_B], cursor: "cursor-3", complete: false, basePath: "/admin/logs", level: "error" }} />),
    ).toBe(
      `${ROW_B_HTML}<tr id="log-load-more" hx-swap-oob="outerHTML:#log-load-more"><td colspan="5" class="px-4 py-2 text-center"><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm" hx-get="/admin/logs?cursor=cursor-3&amp;level=error" hx-target="#log-tbody" hx-swap="beforeend" hx-indicator="this" hx-disabled-elt="this">Load more</button></td></tr>`,
    );
  });

  it("forwards a failed read to the control, appending no rows and keeping the requested cursor", async () => {
    expect(await render(<LogAppendFragment data={{ rows: [], cursor: "abc", complete: false, basePath: "/admin/logs", failed: true }} />)).toBe(
      '<tr id="log-load-more" hx-swap-oob="outerHTML:#log-load-more"><td colspan="5" class="px-4 py-2 text-center"><div data-slot="alert" data-variant="destructive" class="relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm border-status-danger-border bg-status-danger-subtle text-status-danger-subtle-foreground mb-2 text-left"><div data-slot="alert-title" class="font-medium leading-none tracking-tight">Could not load the next page</div><div data-slot="alert-description" class="text-sm leading-relaxed opacity-90">The channel did not answer. The entries already loaded are unaffected.</div></div><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm" hx-get="/admin/logs?cursor=abc" hx-target="#log-tbody" hx-swap="beforeend" hx-indicator="this" hx-disabled-elt="this">Try again</button></td></tr>',
    );
  });

  it("ships the row-shaped control emptied of its button once the stream is complete", async () => {
    expect(await render(<LogAppendFragment data={{ rows: [ROW_A], complete: true, basePath: "/admin/logs" }} />)).toBe(
      `${ROW_A_HTML}<tr id="log-load-more" hx-swap-oob="outerHTML:#log-load-more"><td colspan="5" class="px-4 py-2 text-center"></td></tr>`,
    );
  });
});

// ── LogDetailRow ──────────────────────────────────────────────────────────────────────────────

describe("LogDetailRow", () => {
  const record: LogRecord = {
    level: "error",
    prefix: "api",
    message: "boom",
    timestamp: "2026-05-31T10:00:01.000Z",
    data: { stack: "Error: boom\n  at main.ts:1" },
  };

  it("renders the whole record as a <tr> keeping the detail row's own id", async () => {
    expect(await render(<LogDetailRow record={record} rowKey={ROW_B.key} />)).toBe(
      '<tr id="log-detail-logs--2026-05-31T10-00-01-000Z--bbb" class="border-b border-border"><td colspan="5" class="px-4 py-2"><pre class="max-w-2xl overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-2 font-mono text-xs text-foreground">{\n  &quot;level&quot;: &quot;error&quot;,\n  &quot;prefix&quot;: &quot;api&quot;,\n  &quot;message&quot;: &quot;boom&quot;,\n  &quot;timestamp&quot;: &quot;2026-05-31T10:00:01.000Z&quot;,\n  &quot;data&quot;: {\n    &quot;stack&quot;: &quot;Error: boom\\n  at main.ts:1&quot;\n  }\n}</pre></td></tr>',
    );
  });

  it("renders the not-found sentence for a missing record, still as that row", async () => {
    expect(await render(<LogDetailRow record={null} rowKey={ROW_B.key} />)).toBe(
      '<tr id="log-detail-logs--2026-05-31T10-00-01-000Z--bbb" class="border-b border-border"><td colspan="5" class="px-4 py-2"><span class="text-sm text-muted-foreground">Log entry not found or expired.</span></td></tr>',
    );
  });
});

// ── LogViewerContent ──────────────────────────────────────────────────────────────────────────

describe("LogViewerContent", () => {
  it("composes the heading, the filter bar and the card-bounded table", async () => {
    expect(await render(<LogViewerContent data={{ rows: [], complete: true, basePath: "/admin/logs" }} icon={icon} />)).toBe(
      `<main id="main-content" class="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-10 lg:px-10"><h1 class="text-2xl font-semibold tracking-tight text-foreground">Request Log</h1>${FILTER_BAR_UNFILTERED_HTML}<div data-slot="card" class="flex flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-sm"><div data-slot="card-content" class="p-0"><div data-slot="scroll-area" data-orientation="vertical" class="relative max-h-96"><div data-slot="scroll-area-viewport" tabindex="0" class="h-full w-full overflow-auto overscroll-contain rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring [scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]"><table class="w-full border-collapse text-sm">${THEAD_HTML}<tbody id="log-tbody">${EMPTY_UNFILTERED_ROW_HTML}</tbody><tfoot><tr id="log-load-more"><td colspan="5" class="px-4 py-2 text-center"></td></tr></tfoot></table></div></div></div></div></main>`,
    );
  });
});
