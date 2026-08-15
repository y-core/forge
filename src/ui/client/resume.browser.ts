import { expect, type Page, test } from "@playwright/test";
import { jsx } from "../../jsx/jsx-runtime";
import { render } from "../../testing/render";
import { type ScopeAttrsProps, scopeAttrs } from "../contracts/scope-attrs";
import { SCOPE_EVENTS } from "../contracts/scope-events";
import { Resumable } from "../server/resumable";
import { mount } from "./browser-test-helper";

declare global {
  interface Window {
    forgeResume: typeof import("./resume");
    forgeSignal: typeof import("./signal");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeSignal: "./ui/client/signal" } };

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

  // Each call owns what it resumed, so the disposers are distinct — but the delegation underneath is
  // shared and refcounted, so a second call installs no second listener and the action fires once.
  test("a second resume() shares the delegation rather than doubling it", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act"), EXPOSE);

    const result = await page.evaluate(() => {
      const calls: string[] = [];
      window.forgeResume.registerScope("demo", { on: { act: () => calls.push("act") } });
      const first = window.forgeResume.resume();
      const second = window.forgeResume.resume();
      document.querySelector<HTMLElement>("#btn")?.click();
      return { distinct: first !== second, calls };
    });

    expect(result).toEqual({ distinct: true, calls: ["act"] });
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

  for (const type of SCOPE_EVENTS) {
    test(`delegates the "${type}" event to its data-on-${type} action`, async ({ page }) => {
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

    expect(result).toEqual({ beforeTeardown: false, afterTeardown: true });
  });

  test("a swap disposes the scope it replaced instead of stacking disposers for the page's life", async ({ page }) => {
    const markup = await scopeMarkup("demo", "act");
    await mount(page, '<div id="host"></div>', EXPOSE);

    const result = await page.evaluate(async (html) => {
      const counts = { setups: 0, disposed: 0 };
      const seen: number[] = [];
      window.forgeResume.registerScope("demo", {
        setup: ({ root }) => {
          const generation = counts.setups++;
          seen[generation] = 0;
          const observer = new MutationObserver((records) => {
            seen[generation] = (seen[generation] ?? 0) + records.length;
          });
          observer.observe(root, { attributes: true });
          return () => {
            counts.disposed += 1;
            observer.disconnect();
          };
        },
      });

      const host = document.querySelector<HTMLElement>("#host");
      if (!host) return null;
      const roots: HTMLElement[] = [];
      for (let i = 0; i < 5; i += 1) {
        // What an htmx swap does to a scope: the previous markup is detached with no notice.
        host.innerHTML = html;
        const root = host.querySelector<HTMLElement>("[data-scope]");
        if (!root) return null;
        roots.push(root);
        window.forgeResume.resumeScope(root);
      }

      // Mutating a *detached* node still notifies a connected observer, so this distinguishes
      // "disconnected" from "merely unreachable".
      for (const root of roots) root.setAttribute("data-touched", "1");
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { ...counts, seen };
    }, markup);

    expect(result).toEqual({ setups: 5, disposed: 4, seen: [0, 0, 0, 0, 1] });
  });

  test("a scope torn down with the runtime resumes again on the next mount", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act"), EXPOSE);

    const result = await page.evaluate(() => {
      const counts = { setups: 0, disposed: 0 };
      window.forgeResume.registerScope("demo", {
        eager: true,
        setup: () => {
          counts.setups += 1;
          return () => {
            counts.disposed += 1;
          };
        },
      });
      const teardown = window.forgeResume.resume();
      teardown();
      const afterTeardown = { ...counts };
      window.forgeResume.resume();
      return { afterTeardown, afterRemount: { ...counts } };
    });

    expect(result).toEqual({ afterTeardown: { setups: 1, disposed: 1 }, afterRemount: { setups: 2, disposed: 1 } });
  });

  test("an effect a setup discarded stops writing to the DOM after teardown", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act", { n: 0 }), EXPOSE);

    const result = await page.evaluate(() => {
      window.forgeResume.registerScope("demo", {
        eager: true,
        setup: ({ root, state }) => {
          window.forgeSignal.effect(() => {
            root.dataset.out = String(state.n?.value);
          });
        },
      });
      const teardown = window.forgeResume.resume();
      const root = document.querySelector<HTMLElement>("[data-scope='demo']");
      const state = root ? window.forgeResume.resumeScope(root) : undefined;
      const beforeTeardown = root?.dataset.out ?? null;
      teardown();
      const n = state?.n;
      if (n) n.value = 1;
      return { beforeTeardown, afterTeardown: root?.dataset.out ?? null };
    });

    expect(result).toEqual({ beforeTeardown: "0", afterTeardown: "0" });
  });

  test("an effect stops writing to the DOM after the swap that detached its root", async ({ page }) => {
    const markup = await scopeMarkup("demo", "act", { n: 0 });
    await mount(page, '<div id="host"></div>', EXPOSE);

    const result = await page.evaluate((html) => {
      window.forgeResume.registerScope("demo", {
        setup: ({ root, state }) => {
          window.forgeSignal.effect(() => {
            root.dataset.out = String(state.n?.value);
          });
        },
      });

      const host = document.querySelector<HTMLElement>("#host");
      if (!host) return null;
      host.innerHTML = html;
      const first = host.querySelector<HTMLElement>("[data-scope]");
      if (!first) return null;
      const firstState = window.forgeResume.resumeScope(first);
      // What an htmx swap does: the previous markup is detached with no notice, and the
      // replacement's resume is what sweeps it.
      host.innerHTML = html;
      const second = host.querySelector<HTMLElement>("[data-scope]");
      if (!second) return null;
      window.forgeResume.resumeScope(second);

      const n = firstState?.n;
      if (n) n.value = 1;
      return { detached: first.dataset.out ?? null, live: second.dataset.out ?? null };
    }, markup);

    expect(result).toEqual({ detached: "0", live: "0" });
  });

  test("a setup's own disposer runs after the effects it created", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act", { n: 0 }), EXPOSE);

    const result = await page.evaluate(() => {
      window.forgeResume.registerScope("demo", {
        eager: true,
        setup: ({ root, state }) => {
          window.forgeSignal.effect(() => {
            root.dataset.out = String(state.n?.value);
          });
          // A still-live effect would flush this write into `data-out`, which is the ordering
          // expressed as DOM state.
          return () => {
            const n = state.n;
            if (n) n.value = 1;
          };
        },
      });
      window.forgeResume.resume()();
      return document.querySelector<HTMLElement>("[data-scope='demo']")?.dataset.out ?? null;
    });

    expect(result).toBe("0");
  });

  test("a torn-down scope rebinds its effects when it resumes again", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act", { n: 0 }), EXPOSE);

    const result = await page.evaluate(() => {
      window.forgeResume.registerScope("demo", {
        eager: true,
        setup: ({ root, state }) => {
          window.forgeSignal.effect(() => {
            root.dataset.out = String(state.n?.value);
          });
        },
      });
      window.forgeResume.resume()();
      window.forgeResume.resume();
      const root = document.querySelector<HTMLElement>("[data-scope='demo']");
      const n = root ? window.forgeResume.resumeScope(root)?.n : undefined;
      if (n) n.value = 2;
      return root?.dataset.out ?? null;
    });

    expect(result).toBe("2");
  });

  test("a setup that throws leaves its root resumable and disposes the effects it created", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act", { n: 0 }), EXPOSE);

    const result = await page.evaluate(() => {
      let attempts = 0;
      const abandoned: Array<{ value: unknown }> = [];
      window.forgeResume.registerScope("demo", {
        setup: ({ root, state }) => {
          attempts += 1;
          const generation = attempts;
          const n = state.n;
          if (n) abandoned.push(n);
          window.forgeSignal.effect(() => {
            root.dataset.out = `${generation}:${state.n?.value}`;
          });
          if (generation === 1) throw new Error("boom");
        },
      });

      const root = document.querySelector<HTMLElement>("[data-scope='demo']");
      if (!root) return null;
      let threw = false;
      try {
        window.forgeResume.resumeScope(root);
      } catch {
        threw = true;
      }
      window.forgeResume.resumeScope(root);
      const afterSecond = root.dataset.out ?? null;
      const orphan = abandoned[0];
      if (orphan) orphan.value = 9;
      return { threw, attempts, afterSecond, out: root.dataset.out ?? null };
    });

    expect(result).toEqual({ threw: true, attempts: 2, afterSecond: "2:0", out: "2:0" });
  });

  test("a throwing scope disposer does not stop the next scope's teardown", async ({ page }) => {
    const two = await render([Resumable({ name: "boomer", children: "a" }), Resumable({ name: "quiet", children: "b" })]);
    await mount(page, two, EXPOSE);

    const result = await page.evaluate(() => {
      window.forgeResume.registerScope("boomer", {
        eager: true,
        setup: () => () => {
          throw new Error("boom");
        },
      });
      window.forgeResume.registerScope("quiet", {
        eager: true,
        setup: ({ root }) => {
          return () => {
            root.dataset.out = "disposed";
          };
        },
      });
      window.forgeResume.resume()();
      return document.querySelector<HTMLElement>("[data-scope='quiet']")?.dataset.out ?? null;
    });

    expect(result).toBe("disposed");
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

test.describe("resume — shadow-root discovery", () => {
  /** Attach `html` inside a shadow root nested `depth` levels below `#host`. */
  async function nest(page: Page, html: string, depth: number, mode: ShadowRootMode = "open"): Promise<void> {
    await mount(page, `<div id="host"></div><template id="source">${html}</template>`, EXPOSE);
    await page.evaluate(
      ({ depth, mode }) => {
        const template = document.querySelector<HTMLTemplateElement>("#source");
        let host = document.querySelector<HTMLElement>("#host");
        if (!template || !host) return;
        for (let level = 1; level < depth; level += 1) {
          const inner = document.createElement("div");
          host.attachShadow({ mode }).append(inner);
          host = inner;
        }
        host.attachShadow({ mode }).append(template.content.cloneNode(true));
      },
      { depth, mode },
    );
  }

  test("an eager scope two shadow levels deep runs its setup", async ({ page }) => {
    await nest(page, await scopeMarkup("demo", "act", { count: 7 }), 2);

    const seen = await page.evaluate(() => {
      let count: unknown = null;
      window.forgeResume.registerScope("demo", {
        eager: true,
        setup: ({ state }) => {
          count = state.count?.value;
        },
      });
      window.forgeResume.resume();
      return count;
    });

    expect(seen).toBe(7);
  });

  test("a closed shadow root is skipped without throwing", async ({ page }) => {
    await nest(page, await scopeMarkup("demo", "act"), 1, "closed");

    const result = await page.evaluate(() => {
      let setups = 0;
      window.forgeResume.registerScope("demo", {
        eager: true,
        setup: () => {
          setups += 1;
        },
      });
      window.forgeResume.resume();
      return setups;
    });

    expect(result).toBe(0);
  });

  test("a ShadowRoot passed as `within` scans only that subtree", async ({ page }) => {
    const outside = await render(Resumable({ name: "demo", children: "outside" }));
    await nest(page, await scopeMarkup("demo", "act"), 1);
    await page.evaluate((html) => document.body.insertAdjacentHTML("beforeend", html), outside);

    const roots = await page.evaluate(() => {
      const seen: string[] = [];
      window.forgeResume.registerScope("demo", { eager: true, setup: ({ root }) => void seen.push(root.textContent ?? "") });
      const shadow = document.querySelector("#host")?.shadowRoot;
      if (shadow) window.forgeResume.resume(shadow);
      return seen;
    });

    expect(roots).toEqual(["go"]);
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

test.describe("resume — a throwing setup is contained", () => {
  async function twoScopes(page: Page): Promise<void> {
    const html = await render([
      Resumable({ name: "thrower", children: jsx("span", { id: "a", children: "a" }) }),
      Resumable({ name: "sibling", children: jsx("span", { id: "b", children: "b" }) }),
    ]);
    await mount(page, html, EXPOSE);
  }

  // Before: the first throw aborted the eager loop, so every later scope stayed dead — and because
  // the teardown was assigned before the loop, a retry short-circuited and never re-ran the pass.
  test("a sibling still resumes, the teardown disposes it, and a second resume re-attempts the thrower", async ({ page }) => {
    await twoScopes(page);

    const result = await page.evaluate(() => {
      const log: string[] = [];
      let attempts = 0;
      window.forgeResume.registerScope("thrower", {
        eager: true,
        setup: () => {
          attempts += 1;
          throw new Error("boom");
        },
      });
      window.forgeResume.registerScope("sibling", {
        eager: true,
        setup: () => {
          log.push("sibling-setup");
          return () => log.push("sibling-disposed");
        },
      });

      const teardown = window.forgeResume.resume();
      const afterFirst = { log: [...log], attempts };

      teardown();
      const afterTeardown = [...log];

      window.forgeResume.resume();
      return { afterFirst, afterTeardown, attemptsAfterSecond: attempts, finalLog: log };
    });

    expect(result.afterFirst.log, "the thrower took its sibling down with it").toEqual(["sibling-setup"]);
    expect(result.afterFirst.attempts).toBe(1);
    expect(result.afterTeardown, "the caller never got a usable teardown").toEqual(["sibling-setup", "sibling-disposed"]);
    expect(result.attemptsAfterSecond, "the retry short-circuited instead of re-running the eager pass").toBe(2);
    expect(result.finalLog.at(-1), "the sibling did not come back on the second resume").toBe("sibling-setup");
  });

  // Malformed `data-state` is server-authored markup, so it throws — and the throw is contained to
  // its own scope by the per-scope catch above.
  test("a scope with malformed data-state throws without taking the page down", async ({ page }) => {
    const html = `<div data-scope="broken" data-state="{nope"></div><div data-scope="sibling"></div>`;
    await mount(page, html, EXPOSE);

    const log = await page.evaluate(() => {
      const seen: string[] = [];
      window.forgeResume.registerScope("broken", {
        eager: true,
        setup: () => {
          seen.push("broken-setup");
        },
      });
      window.forgeResume.registerScope("sibling", {
        eager: true,
        setup: () => {
          seen.push("sibling-setup");
        },
      });
      window.forgeResume.resume();
      return seen;
    });

    expect(log, "the broken scope ran its setup on state that never parsed").toEqual(["sibling-setup"]);
  });
});

test.describe("resume — installing listeners and resuming a tree are two jobs", () => {
  // Before: `resume()` returned early on the second call, so the shadow subtree was never scanned
  // and a web component resuming its own tree came back silently inert.
  test("resume() then resume(host.shadowRoot) runs the inner setup", async ({ page }) => {
    const inner = await render(Resumable({ name: "inner", children: jsx("span", { id: "deep", children: "deep" }) }));
    await mount(page, `<div id="host"></div><template id="source">${inner}</template>`, EXPOSE);

    const log = await page.evaluate(() => {
      const seen: string[] = [];
      window.forgeResume.registerScope("inner", {
        eager: true,
        setup: () => {
          seen.push("inner-setup");
        },
      });

      window.forgeResume.resume();

      const host = document.querySelector("#host") as HTMLElement;
      const shadow = host.attachShadow({ mode: "open" });
      shadow.append((document.querySelector("#source") as HTMLTemplateElement).content.cloneNode(true));

      window.forgeResume.resume(shadow);
      return seen;
    });

    expect(log, "the shadow subtree was never visited").toEqual(["inner-setup"]);
  });

  // Refcounted per document: the first teardown must not strip the listeners the second call relies on.
  test("the first teardown leaves the second call's delegation installed", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "ping"), EXPOSE);

    const calls = await page.evaluate(() => {
      const seen: string[] = [];
      window.forgeResume.registerScope("demo", { on: { ping: () => seen.push("ping") } });

      const first = window.forgeResume.resume();
      window.forgeResume.resume();
      first();

      document.querySelector<HTMLElement>("#btn")?.click();
      return seen;
    });

    expect(calls, "the first disposer tore down delegation the second holder still needed").toEqual(["ping"]);
  });

  // A lazily-resumed scope belongs to no call's `mine`, so without the last-holder sweep its effects
  // outlive the runtime that stopped listening for them.
  test("the last disposer stops a lazily-hydrated scope's effects", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act", { n: 0 }), EXPOSE);

    const result = await page.evaluate(() => {
      let signal: { value: unknown } | undefined;
      window.forgeResume.registerScope("demo", {
        setup: ({ root, state }) => {
          signal = state.n;
          window.forgeSignal.effect(() => {
            root.dataset.out = String(state.n?.value);
          });
        },
        on: {},
      });

      const teardown = window.forgeResume.resume();
      document.querySelector<HTMLElement>("#btn")?.click();
      const root = document.querySelector<HTMLElement>("[data-scope='demo']");
      const afterHydration = root?.dataset.out ?? null;

      teardown();
      if (signal) signal.value = 1;
      return { afterHydration, afterTeardown: root?.dataset.out ?? null };
    });

    expect(result, "the lazily-hydrated scope kept writing to the DOM after its runtime went away").toEqual({
      afterHydration: "0",
      afterTeardown: "0",
    });
  });

  // The sweep is the last holder's job alone: a disposer that swept unconditionally would kill a
  // scope the remaining holder still owns.
  test("disposing one of two holders leaves a lazily-hydrated scope live", async ({ page }) => {
    await mount(page, await scopeMarkup("demo", "act", { n: 0 }), EXPOSE);

    const result = await page.evaluate(() => {
      const calls: string[] = [];
      let signal: { value: unknown } | undefined;
      window.forgeResume.registerScope("demo", {
        setup: ({ root, state }) => {
          signal = state.n;
          window.forgeSignal.effect(() => {
            root.dataset.out = String(state.n?.value);
          });
        },
        on: { act: () => calls.push("act") },
      });

      const first = window.forgeResume.resume();
      const second = window.forgeResume.resume();
      document.querySelector<HTMLElement>("#btn")?.click();
      const root = document.querySelector<HTMLElement>("[data-scope='demo']");

      first();
      if (signal) signal.value = 1;
      document.querySelector<HTMLElement>("#btn")?.click();
      const afterFirst = { out: root?.dataset.out ?? null, calls: [...calls] };

      second();
      if (signal) signal.value = 2;
      return { afterFirst, afterSecond: root?.dataset.out ?? null };
    });

    expect(result, "the sweep ran on a holder that was not the last one").toEqual({
      afterFirst: { out: "1", calls: ["act", "act"] },
      afterSecond: "1",
    });
  });
});
