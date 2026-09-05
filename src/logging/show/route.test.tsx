/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { Forge } from "../../app/forge-app";
import { definePage } from "../../app/page";
import type { AppContext } from "../../context/types";
import type { FC } from "../../jsx/types";
import { mapHandler } from "../../testing/route";
import { createIcon } from "../../ui/core/icon";
import type { LogChannel, LogQuery, LogRow } from "../types";
import { LOG_LEVELS } from "../types";
import type { LogViewerAccess } from "./route";
import { loadLogViewer } from "./route";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });

interface Ctx {
  theme: string;
}
interface Config {
  dark: boolean;
}

const Layout: FC<{ ctx: Ctx }> = ({ ctx, children }) => (
  <html lang='en' class={ctx.theme}>
    <head>
      <title>Request Log</title>
    </head>
    <body class='bg-background'>{children}</body>
  </html>
);

const ROW: LogRow = {
  key: "logs||2026-05-31T10:00:00.000Z||aaa",
  level: "info",
  prefix: "svc",
  message: "first event",
  timestamp: "2026-05-31T10:00:00.000Z",
};

const emptyChannel: LogChannel = { write: () => {}, read: () => Promise.resolve({ rows: [], complete: true }) };
const pagedChannel: LogChannel = { write: () => {}, read: () => Promise.resolve({ rows: [ROW], complete: false, cursor: "cursor-2" }) };
const failingChannel: LogChannel = { write: () => {}, read: () => Promise.reject(new Error("kv down")) };

interface AppOptions {
  basePath?: string;
  access?: LogViewerAccess;
  channel?: LogChannel;
  channelFactory?: () => LogChannel;
  context?: (c: AppContext, config: Config) => Promise<Ctx>;
  config?: Config;
}

function makeApp(options: AppOptions = {}) {
  const { basePath, access = "allow-unauthenticated", channel = emptyChannel, channelFactory, context, config = { dark: true } } = options;
  const app = new Forge();
  const handler = definePage({
    loader: (c) =>
      loadLogViewer(c as AppContext, config, {
        channel: channelFactory ?? (() => channel),
        access,
        icon,
        context: context ?? ((_c, cfg: Config) => Promise.resolve({ theme: cfg.dark ? "dark" : "" })),
        layout: Layout,
        ...(basePath !== undefined ? { basePath } : {}),
      }),
    view: () => new Response("view-should-not-run", { status: 500 }),
  });
  mapHandler(app, "GET", "/logs", handler);
  return app;
}

const EMPTY_TBODY_HTML =
  '<tbody id="log-tbody"><tr><td colspan="5" class="px-4 py-4 text-center"><div class="flex flex-col items-center gap-2"><span class="text-sm text-muted-foreground">No log entries have been recorded yet.</span></div></td></tr></tbody>';

const ROW_HTML =
  '<tr class="border-b border-border hover:bg-accent"><td class="py-2 ps-4 pe-4 font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">2026-05-31T10:00:00.000Z</td><td class="py-2 pe-4"><span data-slot="badge" data-tone="info" data-appearance="soft" class="inline-flex items-center rounded-selector border-field font-medium px-2.5 py-0.5 text-xs [--tone:var(--color-info)] [--tone-fg:var(--color-info-foreground)] [--tone-text:var(--color-info-text)] [--tone-soft:var(--color-status-info-subtle)] [--tone-soft-fg:var(--color-status-info-subtle-foreground)] [--tone-soft-border:var(--color-status-info-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]">info</span></td><td class="py-2 pe-4 font-mono text-xs text-muted-foreground">svc</td><td class="max-w-xs truncate py-2 pe-4 text-foreground"><button type="button" data-slot="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" aria-expanded="false" aria-controls="log-detail-logs--2026-05-31T10-00-00-000Z--aaa" hx-get="/admin/logs?detail=logs%7C%7C2026-05-31T10%3A00%3A00.000Z%7C%7Caaa" hx-target="#log-detail-logs--2026-05-31T10-00-00-000Z--aaa" hx-swap="outerHTML" hx-indicator="#log-detail-logs--2026-05-31T10-00-00-000Z--aaa" hx-disabled-elt="this">first event</button></td><td class="py-2 pe-4 font-mono text-xs text-muted-foreground">—</td></tr><tr id="log-detail-logs--2026-05-31T10-00-00-000Z--aaa" class="hidden border-b border-border [&amp;.htmx-request]:table-row"><td colspan="5" class="px-4 py-2"><span class="sr-only">Loading log entry detail…</span><div data-slot="skeleton" aria-hidden="true" class="rounded-field bg-muted motion-safe:animate-pulse h-4 w-full"></div></td></tr>';

const PAGE_HTML = `<!DOCTYPE html><html lang="en" class="dark"><head><title>Request Log</title></head><body class="bg-background"><main id="main-content" data-fill-viewport class="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4 px-6 py-10 lg:px-10"><h1 class="text-2xl font-semibold tracking-tight text-balance text-foreground">Request Log</h1><form class="flex flex-wrap items-end gap-2 sm:flex-nowrap" hx-get="/admin/logs" hx-target="#log-tbody" hx-swap="outerHTML" hx-indicator="#log-tbody" hx-disabled-elt="find button[type=&#39;submit&#39;]" hx-push-url="true"><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-destructive-text flex-col [&amp;&gt;*]:w-full min-w-xs flex-1"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm leading-snug font-medium text-foreground group-data-[disabled]/field:opacity-50" for="field-q">Search</label><input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" name="q" type="search" placeholder="message, prefix, requestId…" value="" id="field-q"></fieldset><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-destructive-text flex-col [&amp;&gt;*]:w-full max-w-xs flex-1"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm leading-snug font-medium text-foreground group-data-[disabled]/field:opacity-50" for="field-level">Level</label><div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" data-size="md" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-md text-sm" name="level" id="field-level"><option data-slot="select-option" value="" selected>All</option><option data-slot="select-option" value="debug">debug</option><option data-slot="select-option" value="info">info</option><option data-slot="select-option" value="warn">warn</option><option data-slot="select-option" value="error">error</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div></fieldset><button type="submit" data-slot="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)] [--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)] [--tone-soft-border:var(--color-primary-soft-border)] border-transparent bg-(--tone) text-(--tone-fg) [--focus-ring:var(--tone-fg)] hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]">Filter</button></form><div data-slot="card" class="flex flex-col rounded-box border border-border bg-card text-card-foreground shadow-sm min-h-0 flex-1"><div data-slot="card-content" class="flex min-h-0 flex-1 flex-col p-0"><div data-slot="scroll-area" data-orientation="vertical" class="relative flex max-h-dvh min-h-0 flex-1 flex-col"><section data-slot="scroll-area-viewport" aria-label="Log entries" tabindex="0" class="h-full max-h-[inherit] w-full overflow-auto overscroll-contain rounded-[inherit] focus-ring [scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent] min-h-0 flex-1"><table class="w-full border-collapse text-sm"><thead><tr class="border-b border-border text-start text-xs font-semibold tracking-wide text-muted-foreground uppercase"><th class="py-2 ps-4 pe-4 whitespace-nowrap">Timestamp</th><th class="py-2 pe-4">Level</th><th class="py-2 pe-4">Prefix</th><th class="max-w-xs py-2 pe-4">Message</th><th class="py-2 pe-4">Request ID</th></tr></thead>${EMPTY_TBODY_HTML}<tfoot><tr id="log-load-more"><td colspan="5" class="px-4 py-2 text-center"></td></tr></tfoot></table></section></div></div></div></main></body></html>`;

describe("loadLogViewer — access control", () => {
  it("denies with exactly 403 Forbidden when the access predicate returns false", async () => {
    const res = await makeApp({ access: () => false }).request("/logs");
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("never touches the channel, nor builds the render context, when access is denied", async () => {
    let channelResolved = false;
    let contextResolved = false;
    const app = makeApp({
      access: async () => false,
      channelFactory: () => {
        channelResolved = true;
        return emptyChannel;
      },
      context: () => {
        contextResolved = true;
        return Promise.resolve({ theme: "" });
      },
    });

    const res = await app.request("/logs");

    expect({ status: res.status, channelResolved, contextResolved }).toEqual({ status: 403, channelResolved: false, contextResolved: false });
  });

  it("denies the HTMX fragment path as well (the guard runs in the shared loader)", async () => {
    const res = await makeApp({ access: () => false }).request("/logs", { headers: { "HX-Request": "true" } });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("denies the detail path as well", async () => {
    const res = await makeApp({ access: () => false }).request("/logs?detail=anything");
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it('proceeds when access is the explicit "allow-unauthenticated" literal', async () => {
    const res = await makeApp({ access: "allow-unauthenticated" }).request("/logs");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PAGE_HTML);
  });

  it("proceeds when the access predicate returns true, and is handed the request context", async () => {
    const res = await makeApp({ access: async (c) => c.request.headers.get("x-admin") === "yes" }).request("/logs", {
      headers: { "x-admin": "yes" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PAGE_HTML);
  });

  it("fails closed when the access predicate throws — the rejection reaches the error boundary", async () => {
    const res = await makeApp({
      access: () => {
        throw new Error("access boom");
      },
    }).request("/logs");

    expect(res.status).toBe(500);
    expect(await res.text()).toBe(
      "<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1><p>An unexpected error occurred.</p></body></html>",
    );
  });
});

describe("loadLogViewer — full page (non-HTMX GET)", () => {
  it("renders the viewer inside the consumer's layout, building no shell of its own", async () => {
    const res = await makeApp().request("/logs");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe(PAGE_HTML);
  });

  it("hands `context` the request context and the config argument, in that order", async () => {
    let seenPath: string | undefined;
    let seenConfig: Config | undefined;
    const app = makeApp({
      config: { dark: false },
      context: (c, cfg) => {
        seenPath = c.url.pathname;
        seenConfig = cfg;
        return Promise.resolve({ theme: cfg.dark ? "dark" : "light" });
      },
    });

    const body = await (await app.request("/logs")).text();

    expect({ seenPath, seenConfig }).toEqual({ seenPath: "/logs", seenConfig: { dark: false } });
    expect(body).toBe(PAGE_HTML.replace('<html lang="en" class="dark">', '<html lang="en" class="light">'));
  });

  it("never falls through to the view — the loader short-circuits with a Response", async () => {
    const res = await makeApp().request("/logs");
    expect(res.status).toBe(200);
  });

  it("renders the error state in place when the channel read rejects, still as a 200 page", async () => {
    const res = await makeApp({ channel: failingChannel }).request("/logs");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      PAGE_HTML.replace(
        EMPTY_TBODY_HTML,
        '<tbody id="log-tbody"><tr><td colspan="5" class="px-4 py-4"><div data-slot="alert" data-tone="destructive" data-appearance="soft" class="relative rounded-box border-field py-3 ps-4 pe-4 text-sm [--tone:var(--color-destructive)] [--tone-fg:var(--color-destructive-foreground)] [--tone-text:var(--color-destructive-text)] [--tone-soft:var(--color-status-danger-subtle)] [--tone-soft-fg:var(--color-status-danger-subtle-foreground)] [--tone-soft-border:var(--color-status-danger-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] flex flex-col items-start gap-2" role="alert"><div data-slot="alert-title" class="leading-none font-medium tracking-tight">Could not read the log stream</div><div data-slot="alert-description" class="text-sm leading-relaxed text-pretty opacity-90">The channel did not answer. Entries already loaded are still shown below.</div><button type="button" data-slot="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] bg-transparent [--focus-ring:var(--color-ring)] border-input text-foreground hover:bg-accent hover:text-accent-foreground" hx-get="/admin/logs" hx-target="#log-tbody" hx-swap="outerHTML" hx-indicator="this" hx-disabled-elt="this">Retry</button></div></td></tr></tbody>',
      ),
    );
  });
});

describe("loadLogViewer — HTMX filter submit (no cursor)", () => {
  it("returns the <tbody> partial, with no document around it", async () => {
    const res = await makeApp().request("/logs", { headers: { "HX-Request": "true" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe(EMPTY_TBODY_HTML);
  });

  it("never builds the render context for a fragment — the layout is not in play", async () => {
    let contextResolved = false;
    const app = makeApp({
      context: () => {
        contextResolved = true;
        return Promise.resolve({ theme: "" });
      },
    });

    await app.request("/logs", { headers: { "HX-Request": "true" } });

    expect(contextResolved).toBe(false);
  });

  it("does not treat HX-Request: false as an HTMX request", async () => {
    const res = await makeApp().request("/logs", { headers: { "HX-Request": "false" } });
    expect(await res.text()).toBe(PAGE_HTML);
  });

  it("answers a failed read with the error state inside the tbody, keeping the retry on the filters", async () => {
    const res = await makeApp({ channel: failingChannel }).request("/logs?level=error", { headers: { "HX-Request": "true" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      '<tbody id="log-tbody"><tr><td colspan="5" class="px-4 py-4"><div data-slot="alert" data-tone="destructive" data-appearance="soft" class="relative rounded-box border-field py-3 ps-4 pe-4 text-sm [--tone:var(--color-destructive)] [--tone-fg:var(--color-destructive-foreground)] [--tone-text:var(--color-destructive-text)] [--tone-soft:var(--color-status-danger-subtle)] [--tone-soft-fg:var(--color-status-danger-subtle-foreground)] [--tone-soft-border:var(--color-status-danger-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] flex flex-col items-start gap-2" role="alert"><div data-slot="alert-title" class="leading-none font-medium tracking-tight">Could not read the log stream</div><div data-slot="alert-description" class="text-sm leading-relaxed text-pretty opacity-90">The channel did not answer. Entries already loaded are still shown below.</div><button type="button" data-slot="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] bg-transparent [--focus-ring:var(--color-ring)] border-input text-foreground hover:bg-accent hover:text-accent-foreground" hx-get="/admin/logs?level=error" hx-target="#log-tbody" hx-swap="outerHTML" hx-indicator="this" hx-disabled-elt="this">Retry</button></div></td></tr></tbody>',
    );
  });

  it("returns the whole tbody for an HX filter submit even when a page is available", async () => {
    const res = await makeApp({ channel: pagedChannel }).request("/logs?level=error", { headers: { "HX-Request": "true" } });
    expect(await res.text()).toBe(`<tbody id="log-tbody">${ROW_HTML}</tbody>`);
  });
});

describe("loadLogViewer — HTMX load-more (cursor)", () => {
  it("returns the rows plus the out-of-band load-more row carrying the new cursor and the filters", async () => {
    const res = await makeApp({ channel: pagedChannel }).request("/logs?cursor=abc&level=error&q=pay%20ment", {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      `${ROW_HTML}<tr id="log-load-more" hx-swap-oob="outerHTML:#log-load-more"><td colspan="5" class="px-4 py-2 text-center"><button type="button" data-slot="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" hx-get="/admin/logs?cursor=cursor-2&amp;level=error&amp;q=pay+ment" hx-target="#log-tbody" hx-swap="beforeend" hx-indicator="this" hx-disabled-elt="this">Load more</button></td></tr>`,
    );
  });

  it("drops an unknown level from the following page URL rather than echoing it back", async () => {
    const res = await makeApp({ channel: pagedChannel }).request("/logs?cursor=abc&level=fatal", { headers: { "HX-Request": "true" } });
    expect(await res.text()).toBe(
      `${ROW_HTML}<tr id="log-load-more" hx-swap-oob="outerHTML:#log-load-more"><td colspan="5" class="px-4 py-2 text-center"><button type="button" data-slot="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" hx-get="/admin/logs?cursor=cursor-2" hx-target="#log-tbody" hx-swap="beforeend" hx-indicator="this" hx-disabled-elt="this">Load more</button></td></tr>`,
    );
  });

  it("uses a custom basePath for both the detail and the next-page URLs", async () => {
    const res = await makeApp({ channel: pagedChannel, basePath: "/dashboard/logs" }).request("/logs?cursor=abc", {
      headers: { "HX-Request": "true" },
    });
    expect(await res.text()).toBe(
      `${ROW_HTML.replaceAll("/admin/logs?detail=", "/dashboard/logs?detail=")}<tr id="log-load-more" hx-swap-oob="outerHTML:#log-load-more"><td colspan="5" class="px-4 py-2 text-center"><button type="button" data-slot="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" hx-get="/dashboard/logs?cursor=cursor-2" hx-target="#log-tbody" hx-swap="beforeend" hx-indicator="this" hx-disabled-elt="this">Load more</button></td></tr>`,
    );
  });

  it("answers a failed read with no rows and a control that still names the cursor it was asked for", async () => {
    const res = await makeApp({ channel: failingChannel }).request("/logs?cursor=abc", { headers: { "HX-Request": "true" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      '<tr id="log-load-more" hx-swap-oob="outerHTML:#log-load-more"><td colspan="5" class="px-4 py-2 text-center"><div data-slot="alert" data-tone="destructive" data-appearance="soft" class="relative grid gap-1.5 rounded-box border-field py-3 ps-4 pe-4 text-sm [--tone:var(--color-destructive)] [--tone-fg:var(--color-destructive-foreground)] [--tone-text:var(--color-destructive-text)] [--tone-soft:var(--color-status-danger-subtle)] [--tone-soft-fg:var(--color-status-danger-subtle-foreground)] [--tone-soft-border:var(--color-status-danger-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] mb-2 text-start" role="alert"><div data-slot="alert-title" class="leading-none font-medium tracking-tight">Could not load the next page</div><div data-slot="alert-description" class="text-sm leading-relaxed text-pretty opacity-90">The channel did not answer. The entries already loaded are unaffected.</div></div><button type="button" data-slot="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" hx-get="/admin/logs?cursor=abc" hx-target="#log-tbody" hx-swap="beforeend" hx-indicator="this" hx-disabled-elt="this">Try again</button></td></tr>',
    );
  });
});

describe("loadLogViewer — a rejected read resolves differently on each path", () => {
  it("reports the stream complete for a filter submit, and incomplete with the cursor kept for an append", async () => {
    const app = makeApp({ channel: failingChannel });

    const filterSubmit = await (await app.request("/logs?level=error", { headers: { "HX-Request": "true" } })).text();
    const append = await (await app.request("/logs?cursor=abc&level=error", { headers: { "HX-Request": "true" } })).text();

    expect({ filterSubmit, append }).toEqual({
      filterSubmit:
        '<tbody id="log-tbody"><tr><td colspan="5" class="px-4 py-4"><div data-slot="alert" data-tone="destructive" data-appearance="soft" class="relative rounded-box border-field py-3 ps-4 pe-4 text-sm [--tone:var(--color-destructive)] [--tone-fg:var(--color-destructive-foreground)] [--tone-text:var(--color-destructive-text)] [--tone-soft:var(--color-status-danger-subtle)] [--tone-soft-fg:var(--color-status-danger-subtle-foreground)] [--tone-soft-border:var(--color-status-danger-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] flex flex-col items-start gap-2" role="alert"><div data-slot="alert-title" class="leading-none font-medium tracking-tight">Could not read the log stream</div><div data-slot="alert-description" class="text-sm leading-relaxed text-pretty opacity-90">The channel did not answer. Entries already loaded are still shown below.</div><button type="button" data-slot="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] bg-transparent [--focus-ring:var(--color-ring)] border-input text-foreground hover:bg-accent hover:text-accent-foreground" hx-get="/admin/logs?level=error" hx-target="#log-tbody" hx-swap="outerHTML" hx-indicator="this" hx-disabled-elt="this">Retry</button></div></td></tr></tbody>',
      append:
        '<tr id="log-load-more" hx-swap-oob="outerHTML:#log-load-more"><td colspan="5" class="px-4 py-2 text-center"><div data-slot="alert" data-tone="destructive" data-appearance="soft" class="relative grid gap-1.5 rounded-box border-field py-3 ps-4 pe-4 text-sm [--tone:var(--color-destructive)] [--tone-fg:var(--color-destructive-foreground)] [--tone-text:var(--color-destructive-text)] [--tone-soft:var(--color-status-danger-subtle)] [--tone-soft-fg:var(--color-status-danger-subtle-foreground)] [--tone-soft-border:var(--color-status-danger-border)] border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)] mb-2 text-start" role="alert"><div data-slot="alert-title" class="leading-none font-medium tracking-tight">Could not load the next page</div><div data-slot="alert-description" class="text-sm leading-relaxed text-pretty opacity-90">The channel did not answer. The entries already loaded are unaffected.</div></div><button type="button" data-slot="button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" hx-get="/admin/logs?cursor=abc&amp;level=error" hx-target="#log-tbody" hx-swap="beforeend" hx-indicator="this" hx-disabled-elt="this">Try again</button></td></tr>',
    });
  });
});

describe("loadLogViewer — detail fragment", () => {
  it("returns the detail <tr> — an outerHTML replacement of the row's own detail row", async () => {
    const channel: LogChannel = {
      write: () => {},
      readEntry: () =>
        Promise.resolve({
          level: "error",
          prefix: "client",
          message: "uncaught",
          timestamp: "2026-05-31T10:00:00.000Z",
          data: { stack: "Error: boom\n  at main.ts:1" },
        }),
    };
    const res = await makeApp({ channel }).request(`/logs?detail=${encodeURIComponent(ROW.key)}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe(
      '<tr id="log-detail-logs--2026-05-31T10-00-00-000Z--aaa" class="border-b border-border"><td colspan="5" class="px-4 py-2"><pre class="max-w-2xl overflow-x-auto rounded-lg bg-muted p-2 font-mono text-xs break-all whitespace-pre-wrap text-foreground">{\n  &quot;level&quot;: &quot;error&quot;,\n  &quot;prefix&quot;: &quot;client&quot;,\n  &quot;message&quot;: &quot;uncaught&quot;,\n  &quot;timestamp&quot;: &quot;2026-05-31T10:00:00.000Z&quot;,\n  &quot;data&quot;: {\n    &quot;stack&quot;: &quot;Error: boom\\n  at main.ts:1&quot;\n  }\n}</pre></td></tr>',
    );
  });

  it("passes the requested key through to readEntry undecoded", async () => {
    let requestedKey: string | undefined;
    const channel: LogChannel = {
      write: () => {},
      readEntry: (key) => {
        requestedKey = key;
        return Promise.resolve(null);
      },
    };

    await makeApp({ channel }).request(`/logs?detail=${encodeURIComponent(ROW.key)}`);

    expect(requestedKey).toBe("logs||2026-05-31T10:00:00.000Z||aaa");
  });

  it("renders not-found for a missing entry", async () => {
    const channel: LogChannel = { write: () => {}, readEntry: () => Promise.resolve(null) };
    const res = await makeApp({ channel }).request("/logs?detail=missing");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      '<tr id="log-detail-missing" class="border-b border-border"><td colspan="5" class="px-4 py-2"><span class="text-sm text-muted-foreground">Log entry not found or expired.</span></td></tr>',
    );
  });

  it("renders not-found when the channel has no readEntry at all", async () => {
    const res = await makeApp({ channel: { write: () => {} } }).request("/logs?detail=missing");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      '<tr id="log-detail-missing" class="border-b border-border"><td colspan="5" class="px-4 py-2"><span class="text-sm text-muted-foreground">Log entry not found or expired.</span></td></tr>',
    );
  });
});

describe("loadLogViewer — ?level= validation", () => {
  function makeQueryApp(): { queries: LogQuery[]; app: ReturnType<typeof makeApp> } {
    const queries: LogQuery[] = [];
    const channel: LogChannel = {
      write: () => {},
      read: (query) => {
        queries.push(query ?? {});
        return Promise.resolve({ rows: [], complete: true });
      },
    };
    return { queries, app: makeApp({ channel }) };
  }

  it("drops an unknown level — the channel query carries no level filter", async () => {
    const { queries, app } = makeQueryApp();
    await app.request("/logs?level=fatal");
    expect(queries).toStrictEqual([{}]);
  });

  it("drops a level that differs only in case — the allowed set is matched exactly", async () => {
    const { queries, app } = makeQueryApp();
    await app.request("/logs?level=ERROR");
    expect(queries).toStrictEqual([{}]);
  });

  it("drops an empty level value", async () => {
    const { queries, app } = makeQueryApp();
    await app.request("/logs?level=");
    expect(queries).toStrictEqual([{}]);
  });

  it("drops a level carrying an injected extra value", async () => {
    const { queries, app } = makeQueryApp();
    await app.request("/logs?level=error%2Cwarn");
    expect(queries).toStrictEqual([{}]);
  });

  it("passes each valid level through to the channel query", async () => {
    for (const level of LOG_LEVELS) {
      const { queries, app } = makeQueryApp();
      await app.request(`/logs?level=${level}`);
      expect(queries).toStrictEqual([{ level }]);
    }
  });

  it("keeps the q and cursor filters when the level is dropped", async () => {
    const { queries, app } = makeQueryApp();
    await app.request("/logs?level=fatal&q=payment&cursor=abc");
    expect(queries).toStrictEqual([{ q: "payment", cursor: "abc" }]);
  });

  it("renders the unfiltered page for an unknown level — byte-identical to no level at all", async () => {
    const app = makeApp();
    const bogus = await (await app.request("/logs?level=fatal")).text();
    expect(bogus).toBe(PAGE_HTML);
  });
});
