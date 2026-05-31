/** @jsxImportSource @y-core/forge */
import type { FC, } from "hono/jsx";
import { Button } from "../../ui/core/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/core/card";
import { Field, FieldLabel } from "../../ui/core/field";
import { Input } from "../../ui/core/input";
import { Select, SelectOption } from "../../ui/core/select";
import { cn } from "../../ui/core/utils/cn";
import { cva } from "../../ui/core/utils/cva";
import type { LogRow } from "./reader";

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
  defaultVariants: {
    level: "info",
  },
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
}

/** Filter form for the log viewer — level selector, text search, and HTMX-powered submit. @public */
export const LogFilterBar: FC<LogFilterBarProps> = ({ level, q, targetId, formAction }) => (
  <form
    class="flex flex-wrap items-end gap-3"
    hx-get={formAction}
    hx-target={`#${targetId}`}
    hx-swap="innerHTML"
    hx-push-url="true"
  >
    <Field name="level" class="w-36">
      <FieldLabel>Level</FieldLabel>
      <Select name="level">
        <SelectOption value="" selected={!level}>All</SelectOption>
        <SelectOption value="debug" selected={level === "debug"}>debug</SelectOption>
        <SelectOption value="info" selected={level === "info"}>info</SelectOption>
        <SelectOption value="warn" selected={level === "warn"}>warn</SelectOption>
        <SelectOption value="error" selected={level === "error"}>error</SelectOption>
      </Select>
    </Field>
    <Field name="q" class="flex-1 min-w-48">
      <FieldLabel>Search</FieldLabel>
      <Input name="q" type="search" placeholder="message, prefix, requestId…" value={q ?? ""} />
    </Field>
    <Button type="submit" variant="secondary" size="md">Filter</Button>
  </form>
);

interface LogTableProps {
  rows: LogRow[];
  cursor?: string;
  complete: boolean;
  loadMoreAction: string;
}

/** Table of log rows with level badges and optional load-more button. @public */
export const LogTable: FC<LogTableProps> = ({ rows, cursor, complete, loadMoreAction }) => (
  <div class="overflow-x-auto">
    <table class="w-full border-collapse text-sm">
      <thead>
        <tr class="border-b border-brand-200 text-left text-xs font-semibold uppercase tracking-wide text-brand-600">
          <th class="py-2 pr-4 whitespace-nowrap">Timestamp</th>
          <th class="py-2 pr-4">Level</th>
          <th class="py-2 pr-4">Prefix</th>
          <th class="py-2 pr-4 max-w-xs">Message</th>
          <th class="py-2">Request ID</th>
        </tr>
      </thead>
      <LogTableBody rows={rows} cursor={cursor} complete={complete} loadMoreAction={loadMoreAction} />
    </table>
  </div>
);

interface LogTableBodyProps {
  rows: LogRow[];
  cursor?: string;
  complete: boolean;
  loadMoreAction: string;
}

/** `<tbody>` fragment — returned standalone for HTMX partial swaps. @public */
export const LogTableBody: FC<LogTableBodyProps> = ({ rows, cursor, complete, loadMoreAction }) => (
  <tbody>
    {rows.length === 0 && (
      <tr>
        <td colspan={5} class="py-8 text-center text-brand-500 text-sm">
          No log entries found.
        </td>
      </tr>
    )}
    {rows.map((row) => (
      <tr key={row.key} class="border-b border-brand-100 hover:bg-brand-50">
        <td class="py-2 pr-4 font-mono text-xs text-brand-600 whitespace-nowrap">{row.timestamp}</td>
        <td class="py-2 pr-4">
          <LogLevelBadge level={row.level} />
        </td>
        <td class={cn("py-2 pr-4 font-mono text-xs", "text-brand-700")}>{row.prefix}</td>
        <td class="py-2 pr-4 max-w-xs truncate text-brand-900">{row.message}</td>
        <td class="py-2 font-mono text-xs text-brand-500">{row.requestId ?? "—"}</td>
      </tr>
    ))}
    {!complete && cursor && (
      <tr>
        <td colspan={5} class="py-4 text-center">
          <Button
            variant="ghost"
            size="sm"
            hx-get={`${loadMoreAction}?cursor=${encodeURIComponent(cursor)}`}
            hx-target="closest tbody"
            hx-swap="outerHTML"
          >
            Load more
          </Button>
        </td>
      </tr>
    )}
  </tbody>
);

interface LogViewerPageProps {
  rows: LogRow[];
  cursor?: string;
  complete: boolean;
  level?: string;
  q?: string;
  basePath: string;
  tbodyId: string;
}

/** Self-contained log viewer page shell. @public */
export const LogViewerPage: FC<LogViewerPageProps> = ({
  rows,
  cursor,
  complete,
  level,
  q,
  basePath,
  tbodyId,
}) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Log Viewer</title>
      <script src="https://unpkg.com/htmx.org@2/dist/htmx.min.js" />
    </head>
    <body class="bg-brand-50 p-6 text-brand-900">
      <div class="mx-auto max-w-7xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Log Viewer</CardTitle>
          </CardHeader>
          <CardContent class="space-y-4">
            <LogFilterBar
              level={level}
              q={q}
              targetId={tbodyId}
              formAction={basePath}
            />
            <LogTable
              rows={rows}
              cursor={cursor}
              complete={complete}
              loadMoreAction={basePath}
            />
          </CardContent>
        </Card>
      </div>
    </body>
  </html>
);
