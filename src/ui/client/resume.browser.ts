import { expect, test } from "@playwright/test";
import { jsx } from "../../jsx/jsx-runtime";
import { render } from "../../testing/render";
import { SCOPE_EVENTS } from "../scope-events";
import { Resumable } from "../server/resumable";
import { type ScopeAttrsProps, scopeAttrs } from "../server/scope-attrs";
import { mount } from "./browser-test-helper";

/**
 * `resume()` in a real browser. Every case here dispatches a genuine event and asserts what the
 * runtime *did* — the assertion the retired document-stub harness could not make, because nothing
 * in it dispatched. Markup comes from `Resumable` + `scopeAttrs`, so the delegation contract under
 * test is the one the server actually emits.
 */

declare global {
  interface Window {
    forgeResume: typeof import("./resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume" } };

/** One scope root with a single `data-on-click` button, rendered through the real SSR components. */
function scopeMarkup(name: string, action: string, state?: Record<string, unknown>): Promise<string> {
  return render(
    Resumable({ name, ...(state ? { state } : {}), children: jsx("button", { id: "btn", ...scopeAttrs({ onClick: action }), children: "go" }) }),
  );
}

test.describe("resume — delegation", () => {
  test("a real click runs the scope action exactly once", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act"), EXPOSE);

    const log = await page.evaluate(() => {
      const calls: string[] = [];
      window.forgeResume.registerScope("demo", { on: { act: () => calls.push("act") } });
      window.forgeResume.resume();
      document.querySelector<HTMLElement>("#btn")?.click();
      return calls;
    });

    expect(log).toEqual(["act"]);
  });

  test("the action handler receives the scope root, the firing element and the event", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act"), EXPOSE);

    const seen = await page.evaluate(() => {
      let result = { root: "", el: "", type: "" };
      window.forgeResume.registerScope("demo", {
        on: {
          act: (ctx, event) => {
            result = { root: ctx.root.dataset.scope ?? "", el: ctx.el.id, type: event.type };
          },
        },
      });
      window.forgeResume.resume();
      document.querySelector<HTMLElement>("#btn")?.click();
      return result;
    });

    expect(seen).toEqual({ root: "demo", el: "btn", type: "click" });
  });

  test("teardown stops the delegation: a click after the disposer runs nothing", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act"), EXPOSE);

    const log = await page.evaluate(() => {
      const calls: string[] = [];
      window.forgeResume.registerScope("demo", { on: { act: () => calls.push("act") } });
      const dispose = window.forgeResume.resume();
      document.querySelector<HTMLElement>("#btn")?.click();
      dispose();
      document.querySelector<HTMLElement>("#btn")?.click();
      return calls;
    });

    expect(log).toEqual(["act"]);
  });

  test("a second resume() before teardown returns the same disposer and does not double-fire", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act"), EXPOSE);

    const result = await page.evaluate(() => {
      const calls: string[] = [];
      window.forgeResume.registerScope("demo", { on: { act: () => calls.push("act") } });
      const first = window.forgeResume.resume();
      const second = window.forgeResume.resume();
      document.querySelector<HTMLElement>("#btn")?.click();
      return { same: first === second, calls };
    });

    expect(result).toEqual({ same: true, calls: ["act"] });
  });

  test("re-mounting after teardown restores delegation with a distinct disposer", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act"), EXPOSE);

    const result = await page.evaluate(() => {
      const calls: string[] = [];
      window.forgeResume.registerScope("demo", { on: { act: () => calls.push("act") } });
      const first = window.forgeResume.resume();
      first();
      const second = window.forgeResume.resume();
      document.querySelector<HTMLElement>("#btn")?.click();
      return { distinct: first !== second, calls };
    });

    expect(result).toEqual({ distinct: true, calls: ["act"] });
  });

  // Derived from SCOPE_EVENTS rather than the hand-copied `EVENT_COUNT = 4` the old harness carried:
  // adding an event to the vocabulary adds a case here automatically.
  for (const type of SCOPE_EVENTS) {
    test(`delegates the "${type}" event to its data-on-${type} action`, async ({ page }) => {
      // Same key derivation `scopeAttrs` itself performs — never a hand-copied `onClick` table.
      const key = `on${type.charAt(0).toUpperCase()}${type.slice(1)}` as keyof ScopeAttrsProps;
      const attrs = scopeAttrs({ [key]: "act" } as ScopeAttrsProps);
      const html = await render(Resumable({ name: "demo", children: jsx("span", { id: "target", ...attrs, children: "x" }) }));
      await mount(page, html, EXPOSE);

      const calls = await page.evaluate((eventType) => {
        const seen: string[] = [];
        window.forgeResume.registerScope("demo", { on: { act: () => seen.push(eventType) } });
        window.forgeResume.resume();
        document.querySelector("#target")?.dispatchEvent(new Event(eventType, { bubbles: true }));
        return seen;
      }, type);

      expect(calls).toEqual([type]);
    });
  }
});

test.describe("resume — scope resolution", () => {
  test("an action the inner scope does not own bubbles to the enclosing scope", async ({ page }) => {
    const inner = Resumable({ name: "inner", children: jsx("button", { id: "btn", ...scopeAttrs({ onClick: "act" }), children: "go" }) });
    await mount(page, await render(Resumable({ name: "outer", children: inner })), EXPOSE);

    const log = await page.evaluate(() => {
      const calls: string[] = [];
      window.forgeResume.registerScope("outer", { on: { act: () => calls.push("outer") } });
      window.forgeResume.registerScope("inner", { on: {} });
      window.forgeResume.resume();
      document.querySelector<HTMLElement>("#btn")?.click();
      return calls;
    });

    expect(log).toEqual(["outer"]);
  });

  test("the inner scope wins when it owns the action", async ({ page }) => {
    const inner = Resumable({ name: "inner", children: jsx("button", { id: "btn", ...scopeAttrs({ onClick: "act" }), children: "go" }) });
    await mount(page, await render(Resumable({ name: "outer", children: inner })), EXPOSE);

    const log = await page.evaluate(() => {
      const calls: string[] = [];
      window.forgeResume.registerScope("outer", { on: { act: () => calls.push("outer") } });
      window.forgeResume.registerScope("inner", { on: { act: () => calls.push("inner") } });
      window.forgeResume.resume();
      document.querySelector<HTMLElement>("#btn")?.click();
      return calls;
    });

    expect(log).toEqual(["inner"]);
  });

  test("a setup-only scope with no `on` table resumes on interaction without throwing", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "nobody-handles-this"), EXPOSE);

    const result = await page.evaluate(() => {
      let setups = 0;
      window.forgeResume.registerScope("demo", {
        setup: () => {
          setups += 1;
        },
      });
      window.forgeResume.resume();
      document.querySelector<HTMLElement>("#btn")?.click();
      return setups;
    });

    expect(result).toBe(1);
  });
});

test.describe("resume — the disposer contract", () => {
  test("a disposer returned from setup runs when the resume teardown runs", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act"), EXPOSE);

    const result = await page.evaluate(() => {
      let disposed = false;
      window.forgeResume.registerScope("demo", {
        eager: true,
        setup: () => () => {
          disposed = true;
        },
        on: {},
      });
      const teardown = window.forgeResume.resume();
      const beforeTeardown = disposed;
      teardown();
      return { beforeTeardown, afterTeardown: disposed };
    });

    // Every controller in `ui/client` returns one of these; without the teardown call reaching it,
    // a re-resume leaks every listener the previous one installed.
    expect(result).toEqual({ beforeTeardown: false, afterTeardown: true });
  });

  test("a setup that returns nothing is not treated as a disposer", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act"), EXPOSE);

    const threw = await page.evaluate(() => {
      window.forgeResume.registerScope("demo", { eager: true, setup: () => {}, on: {} });
      try {
        window.forgeResume.resume()();
        return null;
      } catch (error) {
        return String(error);
      }
    });

    expect(threw).toBeNull();
  });
});

test.describe("resume — hydration", () => {
  test("an eager scope runs setup at resume() with zero interaction", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act", { count: 3 }), EXPOSE);

    const result = await page.evaluate(() => {
      let seen: unknown = null;
      window.forgeResume.registerScope("demo", {
        eager: true,
        setup: ({ state }) => {
          seen = state.count?.value;
        },
      });
      window.forgeResume.resume();
      return seen;
    });

    expect(result).toBe(3);
  });

  test("a lazy scope defers setup until the first interaction", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act"), EXPOSE);

    const result = await page.evaluate(() => {
      const runs: string[] = [];
      window.forgeResume.registerScope("demo", {
        setup: () => {
          runs.push("setup");
        },
        on: {
          act: () => {
            runs.push("act");
          },
        },
      });
      window.forgeResume.resume();
      const beforeInteraction = [...runs];
      document.querySelector<HTMLElement>("#btn")?.click();
      return { beforeInteraction, afterInteraction: runs };
    });

    expect(result).toEqual({ beforeInteraction: [], afterInteraction: ["setup", "act"] });
  });

  test("resumeScope hydrates data-state into signals once and is idempotent", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act", { query: "hello" }), EXPOSE);

    const result = await page.evaluate(() => {
      let setups = 0;
      window.forgeResume.registerScope("demo", {
        setup: () => {
          setups += 1;
        },
      });
      const root = document.querySelector<HTMLElement>("[data-scope='demo']");
      if (!root) return null;
      const first = window.forgeResume.resumeScope(root);
      const second = window.forgeResume.resumeScope(root);
      return { setups, value: first?.query?.value, same: first === second };
    });

    expect(result).toEqual({ setups: 1, value: "hello", same: true });
  });

  test("resumeScope returns undefined for an element naming no registered scope", async ({ page }) => {
    await mount(page, await scopeMarkup("unregistered", "act"), EXPOSE);

    const result = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("[data-scope='unregistered']");
      return root ? window.forgeResume.resumeScope(root) === undefined : null;
    });

    expect(result).toBe(true);
  });

  test("resume() warns exactly once for repeated unregistered scope names", async ({ page }) => {
    const two = await render([Resumable({ name: "ghost", children: "a" }), Resumable({ name: "ghost", children: "b" })]);
    await mount(page, two, EXPOSE);

    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });
    await page.evaluate(() => window.forgeResume.resume());

    expect(warnings.filter((line) => line.includes("ghost"))).toHaveLength(1);
  });
});

test.describe("resume — Invoker Commands bridge", () => {
  test("a native --command reaches the scope handler through event.source", async ({ page }) => {
    const html = await render(
      Resumable({ name: "demo", id: "sink", children: jsx("button", { id: "btn", commandfor: "sink", command: "--act", children: "go" }) }),
    );
    await mount(page, html, EXPOSE);

    const result = await page.evaluate(() => {
      const calls: string[] = [];
      window.forgeResume.registerScope("demo", { on: { act: (ctx) => calls.push(ctx.el.id) } });
      window.forgeResume.resume();
      document.querySelector<HTMLElement>("#btn")?.click();
      return calls;
    });

    // Proves the capture-phase registration too: `command` does not bubble, so a bubble-phase
    // delegated listener on `document` would never see it and this would be empty.
    expect(result).toEqual(["btn"]);
  });

  test("a built-in command is left to the platform and never reaches the scope table", async ({ page }) => {
    const html = await render(
      Resumable({
        name: "demo",
        children: [
          jsx("button", { id: "btn", commandfor: "pop", command: "toggle-popover", children: "go" }),
          jsx("div", { id: "pop", popover: "auto", children: "panel" }),
        ],
      }),
    );
    await mount(page, html, EXPOSE);

    const result = await page.evaluate(() => {
      const calls: string[] = [];
      window.forgeResume.registerScope("demo", { on: { "toggle-popover": () => calls.push("handled") } });
      window.forgeResume.resume();
      document.querySelector<HTMLElement>("#btn")?.click();
      return { calls, popoverOpen: document.querySelector("#pop")?.matches(":popover-open") ?? false };
    });

    expect(result).toEqual({ calls: [], popoverOpen: true });
  });
});
