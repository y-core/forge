import { afterEach, describe, expect, it } from "bun:test";

import { createConfig } from "../config/config";
import type { AppContext } from "../context/types";
import { TURNSTILE_FIELD_DEFAULT } from "../form/constants";
import { createController, get, post, route } from "../router/mod";
import { mapHandler } from "../testing/route";
import { v } from "../validation/validation";
import { createApp } from "./app";
import { createErrorPage } from "./error-page";
import { Forge } from "./forge-app";
import { createHandlerFactory } from "./handler-factory";

interface TestEnv {
  SITE_NAME: string;
  [key: string]: unknown;
}

interface TestConfig {
  greeting: string;
}

const { definePage, defineAction } = createHandlerFactory<TestEnv, TestConfig>();

const FORM_HEADERS = { "content-type": "application/x-www-form-urlencoded" };

const NameSchema = v.strictObject({ name: v.pipe(v.string(), v.minLength(1, "name is required")) });

const text = (value: string): Response => new Response(value);

const routes = route({
  home: get("/"),
  task: get("/tasks/:taskId"),
  saveTask: post("/tasks/:taskId"),
  maybeTask: get("/tasks(/:taskId)"),
  archive: get("/archive(/:year)"),
});

let savedFetch: typeof globalThis.fetch | undefined;

afterEach(() => {
  if (savedFetch) {
    globalThis.fetch = savedFetch;
    savedFetch = undefined;
  }
});

function fakeSiteverify(body: object): void {
  savedFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(body))) as unknown as typeof globalThis.fetch;
}

describe("createHandlerFactory — definePage", () => {
  it("produces a working page handler with Bindings pre-bound", async () => {
    const app = new Forge<TestEnv>();
    const page = definePage(routes.home, {
      loader: (c) => ({ greeting: `Hello from ${c.env.SITE_NAME}` }),
      view: (_c, _config, state) => new Response(state.data.greeting),
    });
    mapHandler(app, "GET", "/", page);
    const res = await app.request("/", {}, { SITE_NAME: "forge" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Hello from forge");
  });

  it("still applies page-level cache directives", async () => {
    const app = new Forge<TestEnv>();
    const page = definePage(routes.home, { cache: "no-store", view: () => new Response("ok") });
    mapHandler(app, "GET", "/", page);
    const res = await app.request("/", {}, { SITE_NAME: "x" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("createHandlerFactory — defineAction", () => {
  it("produces a working read → validate → handle pipeline with Bindings pre-bound", async () => {
    const app = new Forge<TestEnv>();
    const action = defineAction(post("/submit"), {
      schema: NameSchema,
      handle: async (data, c) => new Response(`${data.name}@${c.env.SITE_NAME}`),
    });
    mapHandler(app, "POST", "/submit", action);
    const res = await app.request(
      "/submit",
      { method: "POST", headers: FORM_HEADERS, body: new URLSearchParams({ name: "Jane" }) },
      { SITE_NAME: "forge" },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Jane@forge");
  });

  it("keeps the automatic validation-error fragment for invalid input", async () => {
    const app = new Forge<TestEnv>();
    const action = defineAction(post("/submit"), { schema: NameSchema, handle: async (data) => new Response(data.name) });
    mapHandler(app, "POST", "/submit", action);
    const res = await app.request(
      "/submit",
      // name is present but empty — fails validation. (A fully empty URLSearchParams body hits a
      // Bun stream quirk in the body-size counter unrelated to this factory.)
      { method: "POST", headers: FORM_HEADERS, body: new URLSearchParams({ name: "" }) },
      { SITE_NAME: "forge" },
    );
    const html = await res.text();
    expect(res.status).toBe(422);
    expect(html).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5"><li>name</li></ul></div>',
    );
  });
});

describe("createHandlerFactory — type binding", () => {
  it("pre-binds Bindings and ConfigData, so neither the loader nor the view annotates them", async () => {
    const app = createApp<TestEnv>({ config: createConfig({ greeting: { __env: "GREETING" } }, v.object({ greeting: v.string() })) });
    const page = definePage(routes.home, {
      loader: (c, config) => ({ site: c.env.SITE_NAME, greeting: config.greeting }),
      view: (_c, _config, state) => text(`${state.data.greeting}, ${state.data.site}`),
    });
    mapHandler(app, "GET", "/", page);

    const res = await app.request("/", {}, { SITE_NAME: "forge", GREETING: "Hello" });

    expect(await res.text()).toBe("Hello, forge");
  });

  it("infers LoaderData and ActionData from the loader and action, with no type argument", async () => {
    const app = new Forge<TestEnv>();
    const page = definePage(routes.saveTask, {
      loader: () => ({ title: "Write tests" }),
      action: () => ({ saved: 3 }),
      view: (_c, _config, state) => {
        const title: string = state.data.title;
        const saved: number = state.actionData.saved;
        return text(`${title}:${saved}`);
      },
    });
    mapHandler(app, "POST", "/tasks/:taskId", page);

    const res = await app.request("/tasks/7", { method: "POST" }, { SITE_NAME: "forge" });

    expect(await res.text()).toBe("Write tests:3");
  });

  it("refuses a view that reads a loader field the loader never returns", () => {
    definePage(routes.home, {
      loader: () => ({ title: "Write tests" }),
      // @ts-expect-error -- LoaderData is `{ title: string }`, which has no `body`
      view: (_c, _config, state) => text(state.data.body),
    });
  });
});

describe("createHandlerFactory — params typed from the route", () => {
  it("types a captured param as a string in a page's loader and view", async () => {
    const app = new Forge<TestEnv>();
    const page = definePage(routes.task, {
      loader: (c) => ({ loaded: c.params.taskId }),
      view: (c, _config, state) => text(`${c.params.taskId}/${state.data.loaded}`),
    });
    mapHandler(app, "GET", "/tasks/:taskId", page);

    const res = await app.request("/tasks/42", {}, { SITE_NAME: "forge" });

    expect(await res.text()).toBe("42/42");
  });

  it("types a captured param as a string in a page's action", async () => {
    const app = new Forge<TestEnv>();
    const page = definePage(routes.saveTask, {
      action: (c) => ({ savedFor: c.params.taskId }),
      view: (_c, _config, state) => text(state.actionData.savedFor),
    });
    mapHandler(app, "POST", "/tasks/:taskId", page);

    const res = await app.request("/tasks/42", { method: "POST" }, { SITE_NAME: "forge" });

    expect(await res.text()).toBe("42");
  });

  it("types a captured param as a string in an action's handle and its turnstile verify", async () => {
    fakeSiteverify({ success: true, hostname: "tasks.example" });
    const verifiedFor: string[] = [];
    const app = new Forge<TestEnv>();
    const action = defineAction(routes.saveTask, {
      schema: NameSchema,
      turnstile: {
        secretKey: () => "test-secret",
        verify: (c) => {
          verifiedFor.push(c.params.taskId);
          return { expectedHostname: "tasks.example" };
        },
      },
      handle: (data, c) => text(`${data.name}@${c.params.taskId}`),
    });
    mapHandler(app, "POST", "/tasks/:taskId", action);

    const res = await app.request(
      "/tasks/42",
      { method: "POST", headers: FORM_HEADERS, body: `name=Jane&${TURNSTILE_FIELD_DEFAULT}=solved-token` },
      { SITE_NAME: "forge" },
    );

    expect(await res.text()).toBe("Jane@42");
    expect(verifiedFor).toEqual(["42"]);
  });

  it("types a param inside an optional segment as string | undefined", async () => {
    const app = new Forge<TestEnv>();
    const page = definePage(routes.maybeTask, {
      view: (c) => {
        const taskId: string | undefined = c.params.taskId;
        return text(taskId ?? "none");
      },
    });
    mapHandler(app, "GET", "/tasks(/:taskId)", page);

    const bare = await app.request("/tasks", {}, { SITE_NAME: "forge" });
    const named = await app.request("/tasks/42", {}, { SITE_NAME: "forge" });

    expect(await bare.text()).toBe("none");
    expect(await named.text()).toBe("42");
  });

  it("refuses an optional-segment param where a string is required", () => {
    definePage(routes.maybeTask, {
      // @ts-expect-error -- `(/:taskId)` may be absent, so the param is `string | undefined`
      view: (c) => text(c.params.taskId),
    });
  });

  it("refuses a read of a param the route does not declare", () => {
    definePage(routes.task, {
      // @ts-expect-error -- `/tasks/:taskId` captures no `slug`
      view: (c) => text(c.params.slug),
    });
    defineAction(routes.saveTask, {
      schema: NameSchema,
      // @ts-expect-error -- `/tasks/:taskId` captures no `slug`
      handle: (_data, c) => text(c.params.slug),
    });
  });
});

describe("createHandlerFactory — mapping a handler onto a controller", () => {
  it("accepts a page on the route it names", () => {
    const taskRoutes = route({ task: get("/tasks/:taskId") });
    const taskPage = definePage(taskRoutes.task, { view: (c) => text(c.params.taskId) });

    expect(createController(taskRoutes, { actions: { task: taskPage } }).actions.task).toBe(taskPage);
  });

  it("refuses a page that reads params on a route that captures none", () => {
    const taskPage = definePage(routes.task, { view: (c) => text(c.params.taskId) });
    const paramless = route({ home: get("/") });

    // @ts-expect-error -- the page reads `taskId`, which `/` never captures
    createController(paramless, { actions: { home: taskPage } });
  });

  it("accepts a paramless page on a route with params", async () => {
    const homePage = definePage(routes.home, { view: () => text("home") });
    const taskRoutes = route({ task: get("/tasks/:taskId") });
    const app = new Forge<TestEnv>();
    app.map(taskRoutes, createController(taskRoutes, { actions: { task: homePage } }));

    const res = await app.request("/tasks/42", {}, { SITE_NAME: "forge" });

    expect(await res.text()).toBe("home");
  });
});

describe("createHandlerFactory — an optional-segment route's context reaches APIs typed on AppContext<Bindings>", () => {
  it("accepts createErrorPage as the onError of a page on an optional-segment route", () => {
    definePage(routes.archive, { onError: createErrorPage<TestEnv>(), view: (c) => text(c.params.year ?? "all") });
  });

  it("hands the loader's context to a helper that takes AppContext<Bindings>", async () => {
    const archiveYear = (c: AppContext<TestEnv>): string => c.params.year ?? "all";
    const app = new Forge<TestEnv>();
    const page = definePage(routes.archive, { loader: (c) => ({ year: archiveYear(c) }), view: (_c, _config, state) => text(state.data.year) });
    mapHandler(app, "GET", "/archive(/:year)", page);

    const bare = await app.request("/archive", {}, { SITE_NAME: "forge" });
    const dated = await app.request("/archive/2025", {}, { SITE_NAME: "forge" });

    expect(await bare.text()).toBe("all");
    expect(await dated.text()).toBe("2025");
  });
});
