/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { hxAttrs } from "../../html/htmx/htmx-attrs";
import { oobSwap, SWAP } from "../../html/htmx/htmx-patterns";
import type { FC } from "../../jsx/types";
import { Alert } from "../../ui/core/alert";
import { Badge, type BadgeVariant } from "../../ui/core/badge";
import { Button } from "../../ui/core/button";
import { Card } from "../../ui/core/card";
import { FormField } from "../../ui/core/field-layout";
import type { ForgeIcon } from "../../ui/core/icon";
import { Input } from "../../ui/core/input";
import { ScrollArea } from "../../ui/core/scroll-area";
import { Select } from "../../ui/core/select";
import { Skeleton } from "../../ui/core/skeleton";
import type { LogRecord, LogRow } from "../types";

/** Stable id of the log table tbody; shared so HTMX outerHTML swaps target the node the partial returns. @internal */
export const LOG_TBODY_ID = "log-tbody";

/**
 * Stable id of the load-more row, which the append fragment replaces out of band.
 *
 * The control's `hx-get` carries the cursor it was rendered with, so appending a page leaves it
 * pointing at a cursor already consumed. Replacing it is therefore not optional; doing it out of
 * band is what keeps the control *outside* the region it appends into. One writer, one id — the
 * append fragment is the only thing that ever names this. @internal
 */
export const LOG_LOAD_MORE_ID = "log-load-more";

/** Columns in the log table, so a full-width cell's `colspan` is not restated at five call sites. */
const LOG_COLUMNS = 5;

/**
 * The id of a row's detail region.
 *
 * A log key is `logs||<iso>||<suffix>`, whose `|`, `:` and `.` are all legal in an HTML id and all
 * meaningful in the CSS selector `hx-target` parses — so the key is folded to `[A-Za-z0-9_-]`
 * before it becomes one. Two keys can only collide here by differing *solely* in which punctuation
 * character sits at a given position, which that key format cannot produce: the suffix is what
 * distinguishes two rows at the same instant, and it is alphanumeric.
 */
function detailRowId(key: string): string {
  return `log-detail-${key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

/** Data returned by the log viewer loader. @internal */
export interface LogViewerLoaderData {
  rows: LogRow[];
  cursor?: string;
  complete: boolean;
  level?: string;
  q?: string;
  basePath: string;
  /** Set when the channel read rejected. The table keeps its shape and an `Alert` sits in place of
   *  the rows, rather than the rejection reaching the error boundary — for a fragment request that
   *  boundary returns a non-HTML body, which HTMX would swap into the table. */
  failed?: boolean;
}

/**
 * Which `Badge` variant carries each level.
 *
 * `debug` is `outline` rather than a fifth hue: it is a neutral label, not a status signal, which is
 * `forge-ui-hierarchy-badge-outline-first`. The three that *are* signals take the variants `Badge`
 * owns — the fixed palette utilities stay inside the component, per
 * `forge-ui-color-semantic-variant-fixed`, rather than being copied back out into this markup.
 */
const LEVEL_VARIANT: Readonly<Record<string, BadgeVariant>> = { debug: "outline", info: "info", warn: "warning", error: "destructive" };

/** Badge for a log level. An unknown level falls back to `info` — the level word is still the
 *  badge's own content, so the status is never carried by colour alone. @internal */
export const LogLevelBadge: FC<{ level: string }> = ({ level }) => <Badge variant={LEVEL_VARIANT[level] ?? "info"}>{level}</Badge>;

/** The query string the filter bar's current state resolves to — also what the retry and the
 *  clear-filters controls need. */
function filteredHref(basePath: string, level?: string, q?: string): string {
  const params = new URLSearchParams();
  if (level) params.set("level", level);
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * Builds the next-page URL for the load-more control. The active filters ride along so the
 * appended page is drawn from the same filtered set the table already shows — otherwise page two
 * arrives unfiltered and mixes rows the viewer asked to exclude into the rows it is showing.
 */
function nextPageHref(basePath: string, cursor: string, level?: string, q?: string): string {
  const params = new URLSearchParams({ cursor });
  if (level) params.set("level", level);
  if (q) params.set("q", q);
  return `${basePath}?${params.toString()}`;
}

interface LogFilterBarProps {
  level?: string;
  q?: string;
  targetId: string;
  formAction: string;
  icon: ForgeIcon<"chevron-down">;
}

/**
 * Filter form for the log viewer — level selector, text search, and HTMX-powered submit.
 *
 * The indicator is the **region**, not the button: this is the "a region of content loading" row of
 * the table in `11-htmx.md`, and HTMX's `htmx-request` class on the tbody is what reveals the
 * skeleton rows already sitting in it. The submit is still disabled for the duration.
 * @internal
 */
export const LogFilterBar: FC<LogFilterBarProps> = ({ level, q, targetId, formAction, icon }) => (
  <form
    class='flex flex-wrap sm:flex-nowrap items-end gap-2'
    {...hxAttrs({
      get: formAction,
      target: `#${targetId}`,
      swap: SWAP.outerHtml,
      pushUrl: "true",
      indicator: `#${targetId}`,
      disabledElt: "find button[type='submit']",
    })}>
    <FormField name='q' class='flex-1 min-w-xs'>
      <FormField.Label name='q'>Search</FormField.Label>
      <Input name='q' type='search' placeholder='message, prefix, requestId…' value={q ?? ""} field={{ name: "q" }} />
    </FormField>
    <FormField name='level' class='flex-1 max-w-xs'>
      <FormField.Label name='level'>Level</FormField.Label>
      <Select name='level' field={{ name: "level" }} icon={icon}>
        <Select.Option value='' selected={!level}>
          All
        </Select.Option>
        <Select.Option value='debug' selected={level === "debug"}>
          debug
        </Select.Option>
        <Select.Option value='info' selected={level === "info"}>
          info
        </Select.Option>
        <Select.Option value='warn' selected={level === "warn"}>
          warn
        </Select.Option>
        <Select.Option value='error' selected={level === "error"}>
          error
        </Select.Option>
      </Select>
    </FormField>
    <Button type='submit' variant='primary' size='sm'>
      Filter
    </Button>
  </form>
);

interface LogTableProps {
  rows: LogRow[];
  cursor?: string;
  complete: boolean;
  loadMoreAction: string;
  tbodyId?: string;
  level?: string;
  q?: string;
  failed?: boolean;
}

/** The log table — header, body, and the load-more row in a `<tfoot>`. @internal */
export const LogTable: FC<LogTableProps> = ({ rows, cursor, complete, loadMoreAction, tbodyId, level, q, failed }) => (
  <table class='w-full border-collapse text-sm'>
    <thead>
      <tr class='border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
        <th class='py-2 pl-4 pr-4 whitespace-nowrap'>Timestamp</th>
        <th class='py-2 pr-4'>Level</th>
        <th class='py-2 pr-4'>Prefix</th>
        <th class='py-2 pr-4 max-w-xs'>Message</th>
        <th class='py-2 pr-4'>Request ID</th>
      </tr>
    </thead>
    <LogTableBody
      {...(tbodyId !== undefined ? { id: tbodyId } : {})}
      rows={rows}
      loadMoreAction={loadMoreAction}
      {...(level !== undefined ? { level } : {})}
      {...(q !== undefined ? { q } : {})}
      {...(failed !== undefined ? { failed } : {})}
    />
    <tfoot>
      <LogLoadMoreRow
        {...(cursor !== undefined ? { cursor } : {})}
        complete={complete}
        loadMoreAction={loadMoreAction}
        {...(level !== undefined ? { level } : {})}
        {...(q !== undefined ? { q } : {})}
      />
    </tfoot>
  </table>
);

interface LogLoadMoreRowProps {
  cursor?: string;
  complete: boolean;
  loadMoreAction: string;
  level?: string;
  q?: string;
  /** The read this control issued rejected. The cursor is unspent, so the control stays and becomes
   *  its own retry, under a message saying why the page did not arrive. */
  failed?: boolean;
  /** Spread by the append fragment so this row replaces the one already on the page. */
  "hx-swap-oob"?: string;
}

/**
 * The load-more control, as a `<tfoot>` row.
 *
 * It sits **outside** `#log-tbody`, which is what it appends into — a control inside its own swap
 * target is destroyed by the swap and drops focus to `<body>` (`forge-ui-htmx-restore-focus`).
 *
 * A `<tr>` rather than a `Card.Footer` `<div>`, and that is load-bearing rather than stylistic. The
 * append response carries this row out of band beside the new `<tr>`s, and HTMX parses a response
 * into a fragment using a wrapper chosen from its *first* tag: a `<div>` sibling of `<tr>`s is
 * hoisted out by the HTML parser and lost. Keeping both halves of the response `<tr>`-shaped is what
 * makes the out-of-band replacement arrive at all.
 *
 * This row is also where an append failure is reported, rather than the tbody: the rows already in
 * the table are untouched by a page that never arrived, so putting the message at the point of
 * interaction leaves them alone and keeps the retry where the reader's attention already is. The
 * control's own `hx-get` still names the cursor that failed, so it *is* the retry — no second
 * control, and nothing to keep in step with it. @internal
 */
export const LogLoadMoreRow: FC<LogLoadMoreRowProps> = ({ cursor, complete, loadMoreAction, level, q, failed, "hx-swap-oob": oob }) => (
  <tr id={LOG_LOAD_MORE_ID} {...(oob !== undefined ? { "hx-swap-oob": oob } : {})}>
    <td colspan={LOG_COLUMNS} class='px-4 py-2 text-center'>
      {failed ? (
        <Alert variant='destructive' class='mb-2 text-left'>
          <Alert.Title>Could not load the next page</Alert.Title>
          <Alert.Description>The channel did not answer. The entries already loaded are unaffected.</Alert.Description>
        </Alert>
      ) : null}
      {!complete && cursor ? (
        <Button
          variant='ghost'
          size='sm'
          {...hxAttrs({
            get: nextPageHref(loadMoreAction, cursor, level, q),
            target: `#${LOG_TBODY_ID}`,
            swap: SWAP.beforeEnd,
            indicator: "this",
            disabledElt: "this",
          })}>
          {failed ? "Try again" : "Load more"}
        </Button>
      ) : null}
    </td>
  </tr>
);

interface LogRowsProps {
  rows: LogRow[];
  loadMoreAction: string;
}

/**
 * One page of log rows, as a bare `<tr>` sequence — each data row followed by its own detail row.
 *
 * Rendered on its own for a load-more append, and nested inside `LogTableBody` for a whole-table
 * render. @internal
 */
export const LogRows: FC<LogRowsProps> = ({ rows, loadMoreAction }) => (
  <>
    {rows.map((row) => (
      <LogRowPair key={row.key} row={row} loadMoreAction={loadMoreAction} />
    ))}
  </>
);

/**
 * One log row and the detail row that belongs to it.
 *
 * The message control targets its **sibling** detail row rather than its own cell, so the swap never
 * contains the button that triggered it. The detail row ships in the initial render rather than
 * being swapped in (`forge-ui-htmx-reserve-space`): it is the control's `hx-indicator`, so HTMX's
 * `htmx-request` class is what reveals it, and what it reveals is a skeleton at the shape the record
 * will occupy. `Skeleton` is `aria-hidden`, so the `sr-only` line beside it is the announcement the
 * region would otherwise not make.
 */
const LogRowPair: FC<{ row: LogRow; loadMoreAction: string }> = ({ row, loadMoreAction }) => {
  const detailId = detailRowId(row.key);
  return (
    <>
      <tr class='border-b border-border hover:bg-accent'>
        <td class='py-2 pl-4 pr-4 font-mono text-xs tabular-nums whitespace-nowrap text-muted-foreground'>{row.timestamp}</td>
        <td class='py-2 pr-4'>
          <LogLevelBadge level={row.level} />
        </td>
        <td class='py-2 pr-4 font-mono text-xs text-muted-foreground'>{row.prefix}</td>
        <td class='py-2 pr-4 max-w-xs truncate text-foreground'>
          <Button
            variant='ghost'
            size='sm'
            aria-expanded='false'
            aria-controls={detailId}
            {...hxAttrs({
              get: `${loadMoreAction}?detail=${encodeURIComponent(row.key)}`,
              target: `#${detailId}`,
              swap: SWAP.outerHtml,
              indicator: `#${detailId}`,
              disabledElt: "this",
            })}>
            {row.message}
          </Button>
        </td>
        <td class='py-2 pr-4 font-mono text-xs text-muted-foreground'>{row.requestId ?? "—"}</td>
      </tr>
      <tr id={detailId} class='hidden border-b border-border [&.htmx-request]:table-row'>
        <td colspan={LOG_COLUMNS} class='px-4 py-2'>
          {/* Named, but deliberately **not** a live region. One `role='status'` per row is N live
              regions on a page whose budget is one, and `forge-ui-a11y-one-live-region` means it.
              `forge-ui-a11y-spinner-announces` takes its own stated override instead — the wait is a
              single record read, and HTMX disables the trigger for its duration, which is already an
              announced state change on the control the reader touched. */}
          <span class='sr-only'>Loading log entry detail…</span>
          <Skeleton class='h-4 w-full' />
        </td>
      </tr>
    </>
  );
};

interface LogTableBodyProps {
  rows: LogRow[];
  loadMoreAction: string;
  id?: string;
  level?: string;
  q?: string;
  failed?: boolean;
}

/**
 * `<tbody>` fragment — returned standalone for HTMX partial swaps.
 *
 * Carries the surface's empty and error states, because both belong *inside* the table: the header
 * row and the filter bar above it stay put either way, which is what `forge-ui-state-error-inline`
 * asks for and what makes a failed read distinguishable from a filter that matched nothing.
 * @internal
 */
export const LogTableBody: FC<LogTableBodyProps> = ({ id, rows, loadMoreAction, level, q, failed }) => (
  <tbody {...(id !== undefined ? { id } : {})}>
    {failed ? <LogErrorRow {...(level !== undefined ? { level } : {})} {...(q !== undefined ? { q } : {})} retryAction={loadMoreAction} /> : null}
    {!failed && rows.length === 0 ? (
      <LogEmptyRow {...(level !== undefined ? { level } : {})} {...(q !== undefined ? { q } : {})} clearAction={loadMoreAction} />
    ) : null}
    <LogRows rows={rows} loadMoreAction={loadMoreAction} />
  </tbody>
);

/**
 * The empty state.
 *
 * `forge-ui-state-empty-composed` grants a log stream the standalone-sentence override — there is no
 * user-initiated way to fill a log — **on condition that the sentence says why**, so the two causes
 * are spelled out separately rather than sharing one "No log entries found." A filter that matched
 * nothing additionally keeps its control and gains one that clears it, which is
 * `forge-ui-state-hide-empty-controls`' own override.
 */
const LogEmptyRow: FC<{ level?: string; q?: string; clearAction: string }> = ({ level, q, clearAction }) => {
  const filtered = Boolean(level) || Boolean(q);
  return (
    <tr>
      <td colspan={LOG_COLUMNS} class='px-4 py-4 text-center'>
        <div class='flex flex-col items-center gap-2'>
          <span class='text-sm text-muted-foreground'>
            {filtered ? "No log entries match these filters — the stream itself may not be empty." : "No log entries have been recorded yet."}
          </span>
          {filtered ? (
            <Button
              variant='secondary'
              size='sm'
              {...hxAttrs({
                get: clearAction,
                target: `#${LOG_TBODY_ID}`,
                swap: SWAP.outerHtml,
                pushUrl: clearAction,
                indicator: "this",
                disabledElt: "this",
              })}>
              Clear filters
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
};

/**
 * The error state — in place, with the table's own shape preserved around it.
 *
 * The retry re-issues the read the filters describe, so the reader lands back where they were rather
 * than on an unfiltered stream (`forge-ui-state-error-retry`).
 */
const LogErrorRow: FC<{ level?: string; q?: string; retryAction: string }> = ({ level, q, retryAction }) => (
  <tr>
    <td colspan={LOG_COLUMNS} class='px-4 py-4'>
      <Alert variant='destructive' class='flex flex-col items-start gap-2'>
        <Alert.Title>Could not read the log stream</Alert.Title>
        <Alert.Description>The channel did not answer. Entries already loaded are still shown below.</Alert.Description>
        <Button
          variant='secondary'
          size='sm'
          {...hxAttrs({
            get: filteredHref(retryAction, level, q),
            target: `#${LOG_TBODY_ID}`,
            swap: SWAP.outerHtml,
            indicator: "this",
            disabledElt: "this",
          })}>
          Retry
        </Button>
      </Alert>
    </td>
  </tr>
);

/**
 * The append fragment — the next page of rows, plus the load-more row carrying its new cursor out of
 * band. Both halves are `<tr>`-shaped so HTMX's fragment parse keeps them; see `LogLoadMoreRow`.
 * @internal
 */
export const LogAppendFragment: FC<{ data: LogViewerLoaderData }> = ({ data }) => (
  <>
    <LogRows rows={data.rows} loadMoreAction={data.basePath} />
    <LogLoadMoreRow
      {...(data.cursor !== undefined ? { cursor: data.cursor } : {})}
      complete={data.complete}
      loadMoreAction={data.basePath}
      {...(data.level !== undefined ? { level: data.level } : {})}
      {...(data.q !== undefined ? { q: data.q } : {})}
      {...(data.failed !== undefined ? { failed: data.failed } : {})}
      {...oobSwap({ selector: `#${LOG_LOAD_MORE_ID}` })}
    />
  </>
);

/**
 * Expanded detail row — the full stored record (including `data.stack` when present) as
 * pretty-printed JSON. Rendered as the HTMX `outerHTML` replacement of a row's own detail row, so it
 * keeps that row's id and the trigger beside it survives the swap. @internal
 */
export const LogDetailRow: FC<{ record: LogRecord | null; rowKey: string }> = ({ record, rowKey }) => (
  <tr id={detailRowId(rowKey)} class='border-b border-border'>
    <td colspan={LOG_COLUMNS} class='px-4 py-2'>
      {record === null ? (
        <span class='text-sm text-muted-foreground'>Log entry not found or expired.</span>
      ) : (
        <pre class='max-w-2xl overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-2 font-mono text-xs text-foreground'>
          {JSON.stringify(record, null, 2)}
        </pre>
      )}
    </td>
  </tr>
);

/**
 * Full log viewer content — heading, filter bar, and the bounded table.
 *
 * The table bleeds to the card's border (`Card.Content class='p-0'`), which is the case
 * `forge-ui-layout-card-section-rhythm` names verbatim, and is bounded by a `ScrollArea` so a long
 * stream scrolls inside the card rather than extending the page. @internal
 */
export const LogViewerContent: FC<{ data: LogViewerLoaderData; icon: ForgeIcon<"chevron-down"> }> = ({ data, icon }) => (
  <main id='main-content' class='mx-auto flex max-w-7xl flex-col gap-4 px-6 py-10 lg:px-10'>
    <h1 class='text-2xl font-semibold tracking-tight text-foreground'>Request Log</h1>
    <LogFilterBar
      {...(data.level !== undefined ? { level: data.level } : {})}
      {...(data.q !== undefined ? { q: data.q } : {})}
      targetId={LOG_TBODY_ID}
      formAction={data.basePath}
      icon={icon}
    />
    <Card>
      <Card.Content class='p-0'>
        <ScrollArea class='max-h-96'>
          <ScrollArea.Viewport>
            <LogTable
              rows={data.rows}
              {...(data.cursor !== undefined ? { cursor: data.cursor } : {})}
              complete={data.complete}
              loadMoreAction={data.basePath}
              tbodyId={LOG_TBODY_ID}
              {...(data.level !== undefined ? { level: data.level } : {})}
              {...(data.q !== undefined ? { q: data.q } : {})}
              {...(data.failed !== undefined ? { failed: data.failed } : {})}
            />
          </ScrollArea.Viewport>
        </ScrollArea>
      </Card.Content>
    </Card>
  </main>
);
