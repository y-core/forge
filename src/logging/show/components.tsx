/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC } from "../../jsx/types";
import { Button } from "../../ui/core/button";
import { FormField } from "../../ui/core/field-layout";
import type { ForgeIcon } from "../../ui/core/icon";
import { Input } from "../../ui/core/input";
import { Select } from "../../ui/core/select";
import { cn } from "../../ui/core/utils/cn";
import { cva } from "../../ui/core/utils/cva";
import type { LogRow } from "../types";

/** Stable id of the log table tbody; shared so HTMX outerHTML swaps target the node the partial returns. @public */
export const LOG_TBODY_ID = "log-tbody";

/** Data returned by the log viewer loader. @public */
export interface LogViewerLoaderData {
  rows: LogRow[];
  cursor?: string;
  complete: boolean;
  level?: string;
  q?: string;
  basePath: string;
}

const levelBadgeVariants = cva({
  base: "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
  variants: {
    level: {
      debug: "bg-brand-100 text-brand-600",
      info: "bg-blue-100 text-blue-700",
      warn: "bg-amber-100 text-amber-700",
      error: "bg-red-100 text-red-700",
    },
  },
  defaultVariants: { level: "info" },
});

type LevelVariant = "debug" | "info" | "warn" | "error";

interface LogLevelBadgeProps {
  level: string;
}

/** Colored badge for a log level. @public */
export const LogLevelBadge: FC<LogLevelBadgeProps> = ({ level }) => {
  const variant = (["debug", "info", "warn", "error"].includes(level) ? level : "info") as LevelVariant;
  return <span class={levelBadgeVariants({ level: variant })}>{level}</span>;
};

interface LogFilterBarProps {
  level?: string;
  q?: string;
  targetId: string;
  formAction: string;
  icon: ForgeIcon<"chevron-down">;
}

/** Filter form for the log viewer — level selector, text search, and HTMX-powered submit. @public */
export const LogFilterBar: FC<LogFilterBarProps> = ({ level, q, targetId, formAction, icon }) => (
  <form class='flex flex-wrap sm:flex-nowrap items-end gap-3' hx-get={formAction} hx-target={`#${targetId}`} hx-swap='outerHTML' hx-push-url='true'>
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
    <Button type='submit' variant='secondary' size='md'>
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
}

/** Table of log rows with level badges and optional load-more button. @public */
export const LogTable: FC<LogTableProps> = ({ rows, cursor, complete, loadMoreAction, tbodyId }) => (
  <div class='overflow-x-auto'>
    <table class='w-full border-collapse text-sm'>
      <thead>
        <tr class='border-b border-brand-200 text-left text-xs font-semibold uppercase tracking-wide text-brand-600'>
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
        {...(cursor !== undefined ? { cursor } : {})}
        complete={complete}
        loadMoreAction={loadMoreAction}
      />
    </table>
  </div>
);

interface LogTableBodyProps {
  rows: LogRow[];
  cursor?: string;
  complete: boolean;
  loadMoreAction: string;
  id?: string;
}

/** `<tbody>` fragment — returned standalone for HTMX partial swaps. @public */
export const LogTableBody: FC<LogTableBodyProps> = ({ id, rows, cursor, complete, loadMoreAction }) => (
  <tbody {...(id !== undefined ? { id } : {})}>
    {rows.length === 0 && (
      <tr>
        <td colspan={5} class='py-8 text-center text-brand-500 text-sm'>
          No log entries found.
        </td>
      </tr>
    )}
    {rows.map((row) => (
      <tr key={row.key} class='border-b border-brand-100 hover:bg-brand-50'>
        <td class='py-2 pl-4 pr-4 font-mono text-xs text-brand-600 whitespace-nowrap'>{row.timestamp}</td>
        <td class='py-2 pr-4'>
          <LogLevelBadge level={row.level} />
        </td>
        <td class={cn("py-2 pr-4 font-mono text-xs", "text-brand-700")}>{row.prefix}</td>
        <td class='py-2 pr-4 max-w-xs truncate text-brand-900'>{row.message}</td>
        <td class='py-2 pr-4 font-mono text-xs text-brand-500'>{row.requestId ?? "—"}</td>
      </tr>
    ))}
    {!complete && cursor && (
      <tr>
        <td colspan={5} class='py-4 text-center'>
          <Button
            variant='ghost'
            size='sm'
            hx-get={`${loadMoreAction}?cursor=${encodeURIComponent(cursor)}`}
            hx-target='closest tbody'
            hx-swap='outerHTML'>
            Load more
          </Button>
        </td>
      </tr>
    )}
  </tbody>
);

/** Full log viewer content — filter bar and table. @public */
export const LogViewerContent: FC<{ data: LogViewerLoaderData; icon: ForgeIcon<"chevron-down"> }> = ({ data, icon }) => (
  <main id='main-content' class='mx-auto max-w-7xl px-6 py-10 lg:px-10'>
    <h1 class='mb-6 text-2xl font-semibold text-brand-900'>Request Log</h1>
    <LogFilterBar
      {...(data.level !== undefined ? { level: data.level } : {})}
      {...(data.q !== undefined ? { q: data.q } : {})}
      targetId={LOG_TBODY_ID}
      formAction={data.basePath}
      icon={icon}
    />
    <div class='mt-6 overflow-x-auto rounded-2xl border border-brand-200'>
      <LogTable
        rows={data.rows}
        {...(data.cursor !== undefined ? { cursor: data.cursor } : {})}
        complete={data.complete}
        loadMoreAction={data.basePath}
        tbodyId={LOG_TBODY_ID}
      />
    </div>
  </main>
);
