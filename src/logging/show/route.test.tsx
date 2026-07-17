import { describe, expect, it } from "bun:test";
import { Forge } from "../../app/forge-app";
import { definePage } from "../../app/page";
import { mapHandler } from "../../app/route-test-helper";
import type { KVNamespace } from "../../storage/kv/types";
import { createIcon } from "../../ui/core/icon";
import { kvLogChannel } from "../kv-channel";
import type { LogChannel } from "../types";
import type { LogViewerAccess } from "./route";
import { loadLogViewer } from "./route";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });

function makeKvStub(): KVNamespace {
  return {
    get: () => Promise.resolve(null),
    getWithMetadata: () => Promise.resolve({ value: null, metadata: null }),
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    list: () => Promise.resolve({ keys: [], list_complete: true }),
  } as unknown as KVNamespace;
}

// Drives loadLogViewer through a definePage, mirroring how an app composes it. The loader now
// returns a Response for every path, so it short-circuits before the view runs — the view here
// is a sentinel that must never execute.
function makeApp(options?: { basePath?: string; access?: LogViewerAccess; channel?: (c: unknown) => LogChannel }) {
  const app = new Forge();
  const handler = definePage({
    loader: (c) => loadLogViewer(c, { channel: () => kvLogChannel(makeKvStub()), access: "allow-unauthenticated", icon, ...options }),
    view: () => new Response("view-should-not-run", { status: 500 }),
  });
  mapHandler(app, "GET", "/logs", handler);
  return app;
}

describe("loadLogViewer — access control", () => {
  it("denies with exactly 403 Forbidden when the access predicate returns false", async () => {
    const app = makeApp({ access: () => false });
    const res = await app.request("/logs");
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("never touches the channel when access is denied", async () => {
    let channelResolved = false;
    const app = makeApp({
      access: async () => false,
      channel: () => {
        channelResolved = true;
        return kvLogChannel(makeKvStub());
      },
    });

    const res = await app.request("/logs");
    expect(res.status).toBe(403);
    expect(channelResolved).toBe(false);
  });

  it("denies the HTMX fragment path as well (guard runs in the shared loader)", async () => {
    const app = makeApp({ access: () => false });
    const res = await app.request("/logs", { headers: { "HX-Request": "true" } });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("denies the detail path as well", async () => {
    const app = makeApp({ access: () => false });
    const res = await app.request("/logs?detail=anything");
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it('proceeds when access is the explicit "allow-unauthenticated" literal', async () => {
    const app = makeApp({ access: "allow-unauthenticated" });
    const res = await app.request("/logs");
    expect(res.status).toBe(200);
  });

  it("proceeds when the access predicate returns true", async () => {
    const app = makeApp({ access: async (c) => c.request.headers.get("x-admin") === "yes" });
    const res = await app.request("/logs", { headers: { "x-admin": "yes" } });
    expect(res.status).toBe(200);
  });
});

describe("loadLogViewer — full page (non-HTMX GET)", () => {
  it("returns a 200 text/html full-document Response", async () => {
    const app = makeApp();
    const res = await app.request("/logs");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("renders a complete HTML document (doctype + title + viewer main)", async () => {
    const app = makeApp();
    const res = await app.request("/logs");
    const body = await res.text();
    expect(body).toBe(
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Request Log</title></head><body><main id="main-content" class="mx-auto max-w-7xl px-6 py-10 lg:px-10"><h1 class="mb-6 text-2xl font-semibold text-brand-900">Request Log</h1><form class="flex flex-wrap sm:flex-nowrap items-end gap-3" hx-get="/admin/logs" hx-target="#log-tbody" hx-swap="outerHTML" hx-push-url="true"><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 min-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-q">Search</label><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" name="q" type="search" placeholder="message, prefix, requestId…" value="" id="field-q" aria-describedby="field-q-description"></fieldset><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 max-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-level">Level</label><div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" name="level" id="field-level" aria-describedby="field-level-description"><option data-slot="select-option" value="" selected>All</option><option data-slot="select-option" value="debug">debug</option><option data-slot="select-option" value="info">info</option><option data-slot="select-option" value="warn">warn</option><option data-slot="select-option" value="error">error</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div></fieldset><button type="submit" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent h-10 px-4 text-sm">Filter</button></form><div class="mt-6 overflow-x-auto rounded-2xl border border-brand-200"><div class="overflow-x-auto"><table class="w-full border-collapse text-sm"><thead><tr class="border-b border-brand-200 text-left text-xs font-semibold uppercase tracking-wide text-brand-600"><th class="py-2 pl-4 pr-4 whitespace-nowrap">Timestamp</th><th class="py-2 pr-4">Level</th><th class="py-2 pr-4">Prefix</th><th class="py-2 pr-4 max-w-xs">Message</th><th class="py-2 pr-4">Request ID</th></tr></thead><tbody id="log-tbody"><tr><td colspan="5" class="py-8 text-center text-brand-500 text-sm">No log entries found.</td></tr></tbody></table></div></div></main></body></html>',
    );
  });

  it("never falls through to the view (loader short-circuits with a Response)", async () => {
    const app = makeApp();
    const res = await app.request("/logs");
    const body = await res.text();
    // Exact full-page output proves the loader short-circuited (the view sentinel never appears).
    expect(body).toBe(
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Request Log</title></head><body><main id="main-content" class="mx-auto max-w-7xl px-6 py-10 lg:px-10"><h1 class="mb-6 text-2xl font-semibold text-brand-900">Request Log</h1><form class="flex flex-wrap sm:flex-nowrap items-end gap-3" hx-get="/admin/logs" hx-target="#log-tbody" hx-swap="outerHTML" hx-push-url="true"><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 min-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-q">Search</label><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" name="q" type="search" placeholder="message, prefix, requestId…" value="" id="field-q" aria-describedby="field-q-description"></fieldset><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 max-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-level">Level</label><div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" name="level" id="field-level" aria-describedby="field-level-description"><option data-slot="select-option" value="" selected>All</option><option data-slot="select-option" value="debug">debug</option><option data-slot="select-option" value="info">info</option><option data-slot="select-option" value="warn">warn</option><option data-slot="select-option" value="error">error</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div></fieldset><button type="submit" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent h-10 px-4 text-sm">Filter</button></form><div class="mt-6 overflow-x-auto rounded-2xl border border-brand-200"><div class="overflow-x-auto"><table class="w-full border-collapse text-sm"><thead><tr class="border-b border-brand-200 text-left text-xs font-semibold uppercase tracking-wide text-brand-600"><th class="py-2 pl-4 pr-4 whitespace-nowrap">Timestamp</th><th class="py-2 pr-4">Level</th><th class="py-2 pr-4">Prefix</th><th class="py-2 pr-4 max-w-xs">Message</th><th class="py-2 pr-4">Request ID</th></tr></thead><tbody id="log-tbody"><tr><td colspan="5" class="py-8 text-center text-brand-500 text-sm">No log entries found.</td></tr></tbody></table></div></div></main></body></html>',
    );
  });

  it("uses default basePath of /admin/logs in the filter form action", async () => {
    const app = makeApp();
    const res = await app.request("/logs");
    const body = await res.text();
    expect(body).toBe(
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Request Log</title></head><body><main id="main-content" class="mx-auto max-w-7xl px-6 py-10 lg:px-10"><h1 class="mb-6 text-2xl font-semibold text-brand-900">Request Log</h1><form class="flex flex-wrap sm:flex-nowrap items-end gap-3" hx-get="/admin/logs" hx-target="#log-tbody" hx-swap="outerHTML" hx-push-url="true"><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 min-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-q">Search</label><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" name="q" type="search" placeholder="message, prefix, requestId…" value="" id="field-q" aria-describedby="field-q-description"></fieldset><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 max-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-level">Level</label><div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" name="level" id="field-level" aria-describedby="field-level-description"><option data-slot="select-option" value="" selected>All</option><option data-slot="select-option" value="debug">debug</option><option data-slot="select-option" value="info">info</option><option data-slot="select-option" value="warn">warn</option><option data-slot="select-option" value="error">error</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div></fieldset><button type="submit" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent h-10 px-4 text-sm">Filter</button></form><div class="mt-6 overflow-x-auto rounded-2xl border border-brand-200"><div class="overflow-x-auto"><table class="w-full border-collapse text-sm"><thead><tr class="border-b border-brand-200 text-left text-xs font-semibold uppercase tracking-wide text-brand-600"><th class="py-2 pl-4 pr-4 whitespace-nowrap">Timestamp</th><th class="py-2 pr-4">Level</th><th class="py-2 pr-4">Prefix</th><th class="py-2 pr-4 max-w-xs">Message</th><th class="py-2 pr-4">Request ID</th></tr></thead><tbody id="log-tbody"><tr><td colspan="5" class="py-8 text-center text-brand-500 text-sm">No log entries found.</td></tr></tbody></table></div></div></main></body></html>',
    );
  });

  it("reflects a custom basePath in the rendered form action", async () => {
    const app = makeApp({ basePath: "/dashboard/logs" });
    const res = await app.request("/logs");
    const body = await res.text();
    expect(body).toBe(
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Request Log</title></head><body><main id="main-content" class="mx-auto max-w-7xl px-6 py-10 lg:px-10"><h1 class="mb-6 text-2xl font-semibold text-brand-900">Request Log</h1><form class="flex flex-wrap sm:flex-nowrap items-end gap-3" hx-get="/dashboard/logs" hx-target="#log-tbody" hx-swap="outerHTML" hx-push-url="true"><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 min-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-q">Search</label><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" name="q" type="search" placeholder="message, prefix, requestId…" value="" id="field-q" aria-describedby="field-q-description"></fieldset><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 max-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-level">Level</label><div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" name="level" id="field-level" aria-describedby="field-level-description"><option data-slot="select-option" value="" selected>All</option><option data-slot="select-option" value="debug">debug</option><option data-slot="select-option" value="info">info</option><option data-slot="select-option" value="warn">warn</option><option data-slot="select-option" value="error">error</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div></fieldset><button type="submit" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent h-10 px-4 text-sm">Filter</button></form><div class="mt-6 overflow-x-auto rounded-2xl border border-brand-200"><div class="overflow-x-auto"><table class="w-full border-collapse text-sm"><thead><tr class="border-b border-brand-200 text-left text-xs font-semibold uppercase tracking-wide text-brand-600"><th class="py-2 pl-4 pr-4 whitespace-nowrap">Timestamp</th><th class="py-2 pr-4">Level</th><th class="py-2 pr-4">Prefix</th><th class="py-2 pr-4 max-w-xs">Message</th><th class="py-2 pr-4">Request ID</th></tr></thead><tbody id="log-tbody"><tr><td colspan="5" class="py-8 text-center text-brand-500 text-sm">No log entries found.</td></tr></tbody></table></div></div></main></body></html>',
    );
  });

  it("pre-selects the level from the query param", async () => {
    const app = makeApp();
    const res = await app.request("/logs?level=error");
    const body = await res.text();
    expect(body).toBe(
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Request Log</title></head><body><main id="main-content" class="mx-auto max-w-7xl px-6 py-10 lg:px-10"><h1 class="mb-6 text-2xl font-semibold text-brand-900">Request Log</h1><form class="flex flex-wrap sm:flex-nowrap items-end gap-3" hx-get="/admin/logs" hx-target="#log-tbody" hx-swap="outerHTML" hx-push-url="true"><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 min-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-q">Search</label><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" name="q" type="search" placeholder="message, prefix, requestId…" value="" id="field-q" aria-describedby="field-q-description"></fieldset><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 max-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-level">Level</label><div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" name="level" id="field-level" aria-describedby="field-level-description"><option data-slot="select-option" value="">All</option><option data-slot="select-option" value="debug">debug</option><option data-slot="select-option" value="info">info</option><option data-slot="select-option" value="warn">warn</option><option data-slot="select-option" value="error" selected>error</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div></fieldset><button type="submit" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent h-10 px-4 text-sm">Filter</button></form><div class="mt-6 overflow-x-auto rounded-2xl border border-brand-200"><div class="overflow-x-auto"><table class="w-full border-collapse text-sm"><thead><tr class="border-b border-brand-200 text-left text-xs font-semibold uppercase tracking-wide text-brand-600"><th class="py-2 pl-4 pr-4 whitespace-nowrap">Timestamp</th><th class="py-2 pr-4">Level</th><th class="py-2 pr-4">Prefix</th><th class="py-2 pr-4 max-w-xs">Message</th><th class="py-2 pr-4">Request ID</th></tr></thead><tbody id="log-tbody"><tr><td colspan="5" class="py-8 text-center text-brand-500 text-sm">No log entries found.</td></tr></tbody></table></div></div></main></body></html>',
    );
  });

  it("pre-fills the search query from the q param", async () => {
    const app = makeApp();
    const res = await app.request("/logs?q=payment");
    const body = await res.text();
    expect(body).toBe(
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Request Log</title></head><body><main id="main-content" class="mx-auto max-w-7xl px-6 py-10 lg:px-10"><h1 class="mb-6 text-2xl font-semibold text-brand-900">Request Log</h1><form class="flex flex-wrap sm:flex-nowrap items-end gap-3" hx-get="/admin/logs" hx-target="#log-tbody" hx-swap="outerHTML" hx-push-url="true"><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 min-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-q">Search</label><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" name="q" type="search" placeholder="message, prefix, requestId…" value="payment" id="field-q" aria-describedby="field-q-description"></fieldset><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full flex-1 max-w-xs"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-level">Level</label><div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" name="level" id="field-level" aria-describedby="field-level-description"><option data-slot="select-option" value="" selected>All</option><option data-slot="select-option" value="debug">debug</option><option data-slot="select-option" value="info">info</option><option data-slot="select-option" value="warn">warn</option><option data-slot="select-option" value="error">error</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div></fieldset><button type="submit" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent h-10 px-4 text-sm">Filter</button></form><div class="mt-6 overflow-x-auto rounded-2xl border border-brand-200"><div class="overflow-x-auto"><table class="w-full border-collapse text-sm"><thead><tr class="border-b border-brand-200 text-left text-xs font-semibold uppercase tracking-wide text-brand-600"><th class="py-2 pl-4 pr-4 whitespace-nowrap">Timestamp</th><th class="py-2 pr-4">Level</th><th class="py-2 pr-4">Prefix</th><th class="py-2 pr-4 max-w-xs">Message</th><th class="py-2 pr-4">Request ID</th></tr></thead><tbody id="log-tbody"><tr><td colspan="5" class="py-8 text-center text-brand-500 text-sm">No log entries found.</td></tr></tbody></table></div></div></main></body></html>',
    );
  });
});

describe("loadLogViewer — HTMX request", () => {
  it("returns a 200 text/html <tbody> fragment (no doctype) when HX-Request is true", async () => {
    const app = makeApp();
    const res = await app.request("/logs", { headers: { "HX-Request": "true" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body).toBe(
      '<tbody id="log-tbody"><tr><td colspan="5" class="py-8 text-center text-brand-500 text-sm">No log entries found.</td></tr></tbody>',
    );
  });

  it("does not treat HX-Request: false as an HTMX request (renders the full page)", async () => {
    const app = makeApp();
    const res = await app.request("/logs", { headers: { "HX-Request": "false" } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("uses a custom basePath for the load-more action in the fragment", async () => {
    const channel: LogChannel = {
      write: () => {},
      read: () =>
        Promise.resolve({ rows: [{ key: "k", level: "info", prefix: "svc", message: "m", timestamp: "t" }], complete: false, cursor: "abc" }),
    };
    const app = makeApp({ basePath: "/dashboard/logs", channel: () => channel });
    const res = await app.request("/logs", { headers: { "HX-Request": "true" } });
    const body = await res.text();
    expect(body).toBe(
      '<tbody id="log-tbody"><tr class="border-b border-brand-100 hover:bg-brand-50"><td class="py-2 pl-4 pr-4 font-mono text-xs text-brand-600 whitespace-nowrap">t</td><td class="py-2 pr-4"><span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide bg-blue-100 text-blue-700">info</span></td><td class="py-2 pr-4 font-mono text-xs text-brand-700">svc</td><td class="py-2 pr-4 max-w-xs truncate text-brand-900"><button type="button" class="cursor-pointer text-left hover:underline" hx-get="/dashboard/logs?detail=k" hx-target="closest td" hx-swap="outerHTML">m</button></td><td class="py-2 pr-4 font-mono text-xs text-brand-500">—</td></tr><tr><td colspan="5" class="py-4 text-center"><button type="button" data-slot="button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm" hx-get="/dashboard/logs?cursor=abc" hx-target="closest tbody" hx-swap="outerHTML">Load more</button></td></tr></tbody>',
    );
  });
});

describe("loadLogViewer — detail view", () => {
  function makeDetailApp(channel: LogChannel) {
    return makeApp({ channel: () => channel });
  }

  it("returns the detail fragment when ?detail= is present", async () => {
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
    const app = makeDetailApp(channel);

    const res = await app.request(`/logs?detail=${encodeURIComponent("logs||2026-05-31T10:00:00.000Z||aaa")}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await res.text();
    expect(body).toBe(
      '<td class="py-2 pr-4 text-brand-900"><pre class="max-w-2xl overflow-x-auto whitespace-pre-wrap break-all rounded bg-brand-50 p-2 font-mono text-xs text-brand-800">{\n  &quot;level&quot;: &quot;error&quot;,\n  &quot;prefix&quot;: &quot;client&quot;,\n  &quot;message&quot;: &quot;uncaught&quot;,\n  &quot;timestamp&quot;: &quot;2026-05-31T10:00:00.000Z&quot;,\n  &quot;data&quot;: {\n    &quot;stack&quot;: &quot;Error: boom\\n  at main.ts:1&quot;\n  }\n}</pre></td>',
    );
  });

  it("passes the requested key through to readEntry", async () => {
    let requestedKey: string | undefined;
    const channel: LogChannel = {
      write: () => {},
      readEntry: (key) => {
        requestedKey = key;
        return Promise.resolve(null);
      },
    };
    const app = makeDetailApp(channel);

    await app.request(`/logs?detail=${encodeURIComponent("logs||2026-05-31T10:00:00.000Z||bbb")}`);

    expect(requestedKey).toBe("logs||2026-05-31T10:00:00.000Z||bbb");
  });

  it("renders not-found for a missing entry", async () => {
    const channel: LogChannel = { write: () => {}, readEntry: () => Promise.resolve(null) };
    const app = makeDetailApp(channel);

    const res = await app.request("/logs?detail=missing");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      '<td class="py-2 pr-4 text-brand-900"><span class="text-sm text-brand-500">Log entry not found or expired.</span></td>',
    );
  });

  it("renders not-found when the channel has no readEntry", async () => {
    const app = makeDetailApp({ write: () => {} });

    const res = await app.request("/logs?detail=anything");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      '<td class="py-2 pr-4 text-brand-900"><span class="text-sm text-brand-500">Log entry not found or expired.</span></td>',
    );
  });
});
