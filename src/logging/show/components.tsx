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

/** Stable id of the load-more row, which the append fragment replaces out of band. @internal */
export const LOG_LOAD_MORE_ID = "log-load-more";

const LOG_COLUMNS = 5;

// A log key's `|`, `:` and `.` are legal in an HTML id but meaningful in the selector `hx-target` parses.
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
  failed?: boolean;
}

const LEVEL_VARIANT: Readonly<Record<string, BadgeVariant>> = { debug: "outline", info: "info", warn: "warning", error: "destructive" };

/** Badge for a log level; an unknown level falls back to `info`. @internal */
export const LogLevelBadge: FC<{ level: string }> = ({ level }) => <Badge variant={LEVEL_VARIANT[level] ?? "info"}>{level}</Badge>;

function filteredHref(basePath: string, level?: string, q?: string): string {
  const params = new URLSearchParams();
  if (level) params.set("level", level);
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

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

/** Filter form for the log viewer — level selector, text search, and HTMX-powered submit. @internal */
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
  failed?: boolean;
  "hx-swap-oob"?: string;
}

/** The load-more control as a `<tfoot>` `<tr>`; a non-`<tr>` sibling of the appended rows is hoisted away by the HTML fragment parse. @internal */
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

/** One page of log rows, as a bare `<tr>` sequence — each data row followed by its own detail row. @internal */
export const LogRows: FC<LogRowsProps> = ({ rows, loadMoreAction }) => (
  <>
    {rows.map((row) => (
      <LogRowPair key={row.key} row={row} loadMoreAction={loadMoreAction} />
    ))}
  </>
);

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

/** `<tbody>` fragment carrying the empty and error states — returned standalone for HTMX partial swaps. @internal */
export const LogTableBody: FC<LogTableBodyProps> = ({ id, rows, loadMoreAction, level, q, failed }) => (
  <tbody {...(id !== undefined ? { id } : {})}>
    {failed ? <LogErrorRow {...(level !== undefined ? { level } : {})} {...(q !== undefined ? { q } : {})} retryAction={loadMoreAction} /> : null}
    {!failed && rows.length === 0 ? (
      <LogEmptyRow {...(level !== undefined ? { level } : {})} {...(q !== undefined ? { q } : {})} clearAction={loadMoreAction} />
    ) : null}
    <LogRows rows={rows} loadMoreAction={loadMoreAction} />
  </tbody>
);

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

/** The append fragment — the next page of rows, plus the load-more row carrying its new cursor out of band. @internal */
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

/** Expanded detail row — the full stored record as pretty-printed JSON. @internal */
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

/** Full log viewer content — heading, filter bar, and the bounded table. @internal */
export const LogViewerContent: FC<{ data: LogViewerLoaderData; icon: ForgeIcon<"chevron-down"> }> = ({ data, icon }) => (
  // `flex-1 min-h-0` claims the column's leftover height from the consumer's layout and lets the chain
  // below shrink past its content rather than flooring at it.
  //
  // `data-fill-viewport` is the half a page cannot do for itself. `min-h-dvh` on the shell leaves the
  // column's height *indefinite*, and a flex container sized that way takes its height from its items'
  // content — so a long table grows the document however the items are flexed (`min-h-0` and a definite
  // `height: 0` were both measured; neither holds it). Only a definite shell height does, and only the
  // shell can set one. The attribute is the handle a layout switches on:
  //   <body class='flex min-h-dvh flex-col has-[[data-fill-viewport]]:h-dvh has-[[data-fill-viewport]]:overflow-hidden'>
  // A layout that ignores it still renders correctly — the table then falls back to the `max-h-dvh` box.
  <main id='main-content' data-fill-viewport class='mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4 px-6 py-10 lg:px-10'>
    <h1 class='text-2xl font-semibold tracking-tight text-foreground'>Request Log</h1>
    <LogFilterBar
      {...(data.level !== undefined ? { level: data.level } : {})}
      {...(data.q !== undefined ? { q: data.q } : {})}
      targetId={LOG_TBODY_ID}
      formAction={data.basePath}
      icon={icon}
    />
    <Card class='min-h-0 flex-1'>
      <Card.Content class='flex min-h-0 flex-1 flex-col p-0'>
        {/* Every link here grows by `flex-1`, never by a percentage. `h-full` cannot be used: a layout
            bounded by `min-h-dvh` has no *definite* height, so `height: 100%` resolves to `auto` and the
            table grows the page instead of scrolling. `flex-1` needs no definite parent, and the paired
            `min-h-0` lifts the automatic minimum size that would otherwise floor each box at its content.
            `max-h-dvh` is the fallback for a consumer whose layout is not a flex column, where `flex-1`
            is inert: the table then scrolls in a viewport-tall box rather than growing without bound. */}
        <ScrollArea class='flex min-h-0 max-h-dvh flex-1 flex-col'>
          <ScrollArea.Viewport label='Log entries' class='min-h-0 flex-1'>
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
