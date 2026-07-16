/**
 * Resumability-lite client runtime.
 *
 * Instead of an eager load-time mount loop, the server marks interactive elements with
 * a `data-on-<event>` action and an enclosing `[data-scope]` carrying serialized state.
 * A single delegated listener resumes a scope on the FIRST interaction with any descendant:
 * it rebuilds `data-state` into signals, runs the scope's `setup` once to bind effects, and
 * dispatches the named action. Zero work runs at page load; cost is O(1) in page size.
 *
 * @public
 */

import { SCOPE_EVENTS } from "../scope-events";
import { createSignal, effect, type Signal } from "./signal";

/** Context handed to a scope's `setup` and action handlers.
 * @public
 **/
export interface ResumeContext {
  /** The `[data-scope]` element enclosing the interaction. */
  root: HTMLElement;
  /** The element that fired the event (carries the `data-on-<event>` action). */
  el: HTMLElement;
  /** State rebuilt from `data-state` into reactive signals. */
  state: Record<string, Signal<unknown>>;
}

/** A registered scope: one-time setup plus a map of named action handlers. Generic over the
 * action-name union `A` (defaults to `string`, so existing callers infer it from their `on`
 * object literal with no change).
 * @public
 **/
export interface ScopeDefinition<A extends string = string> {
  /** Resume at `resume()` time instead of waiting for the first interaction. */
  eager?: boolean;
  /** Bind DOM-mutating effects ONCE on first resume (no `el` — not tied to one event).
   * May return a disposer; if it does, the disposer is called when `resume()`'s teardown runs. */
  // biome-ignore lint/suspicious/noConfusingVoidType: void in union is intentional — allows implicit-return setups
  setup?: (ctx: Omit<ResumeContext, "el">) => void | (() => void);
  /** Action handlers keyed by the `data-on-<event>` value. Optional: a `setup`-only scope may omit
   * it, in which case `registerScope` defaults it to an empty table. */
  on?: Record<A, (ctx: ResumeContext, event: Event) => void>;
}

const scopes = new Map<string, ScopeDefinition>();
const resumed = new WeakMap<HTMLElement, Record<string, Signal<unknown>>>();
const disposers: Array<() => void> = [];

/** Registers a scope's setup + action handlers, keyed to a `data-scope` name. Generic over the
 * action-name union `A`, inferred from the `on` object literal.
 * @public
 **/
export function registerScope<A extends string = string>(name: string, def: ScopeDefinition<A>): void {
  scopes.set(name, { ...def, on: def.on ?? {} } as ScopeDefinition);
}

let teardown: (() => void) | null = null;

/** Installs one delegated listener per supported event. Idempotent: a second call is a no-op
 *  and returns the same teardown. Returns a disposer that removes all listeners. @public */
export function resume(): () => void {
  if (teardown) return teardown; // already mounted — no duplicate listeners
  const handlers: Array<[string, EventListener, boolean]> = [];
  for (const type of SCOPE_EVENTS) {
    const handler: EventListener = (event) => dispatch(type, event);
    document.addEventListener(type, handler);
    handlers.push([type, handler, false]);
  }
  // Native Invoker Commands bridge: one delegated `command` listener routes custom `--action`
  // commands into the same scope handler table the `data-on-*` events feed. Built-in commands
  // (no `--` prefix) are left to the platform. Companion to the SCOPE_EVENTS listeners above.
  // The platform dispatches `command` with `bubbles:false`, so this listener runs in the capture
  // phase — a bubble-phase delegated listener never sees it and every custom action goes dead.
  const commandHandler: EventListener = (event) => dispatchCommand(event);
  document.addEventListener("command", commandHandler, { capture: true });
  handlers.push(["command", commandHandler, true]);
  teardown = () => {
    for (const [type, handler, capture] of handlers) document.removeEventListener(type, handler, capture);
    for (const d of disposers.splice(0)) d();
    teardown = null;
  };
  // Eager pass: scopes that opt out of lazy resume are hydrated immediately. An element whose
  // `data-scope` names no registered definition is always a bug — the app forgot to
  // side-effect-import the client module that registers it. Warn once per unknown name.
  const warnedUnknown = new Set<string>();
  for (const el of document.querySelectorAll<HTMLElement>("[data-scope]")) {
    const name = el.dataset.scope ?? "";
    const def = scopes.get(name);
    if (!def) {
      if (!warnedUnknown.has(name)) {
        warnedUnknown.add(name);
        console.warn(
          `[resume] no scope registered for data-scope="${name}" — side-effect-import the client module that registers it (e.g. "ui/core/client") before calling resume().`,
        );
      }
      continue;
    }
    if (def.eager) ensureResumed(el, def);
  }
  return teardown;
}

/** Hydrates a scope's state into signals and runs its `setup` exactly once. Idempotent: a
 * second call returns the already-built state without re-running `setup`. */
function ensureResumed(root: HTMLElement, def: ScopeDefinition): Record<string, Signal<unknown>> {
  let state = resumed.get(root);
  if (!state) {
    state = hydrateState(root.dataset.state);
    resumed.set(root, state);
    const dispose = def.setup?.({ root, state });
    if (dispose) disposers.push(dispose);
  }
  return state;
}

/** Resume a single scope now (idempotent); returns its signal state, or `undefined` if the
 * element's `data-scope` names no registered scope. @public */
export function resumeScope(root: HTMLElement): Record<string, Signal<unknown>> | undefined {
  const def = scopes.get(root.dataset.scope ?? "");
  return def ? ensureResumed(root, def) : undefined;
}

/** Walk up from `el` through `[data-scope]` ancestors and invoke the first scope whose `on` table
 * owns `action`, resuming it on the way. Shared by the `data-on-*` and `command` dispatchers. */
function runAction(action: string, el: HTMLElement, event: Event): void {
  let scopeEl = el.closest<HTMLElement>("[data-scope]");
  while (scopeEl) {
    const def = scopes.get(scopeEl.dataset.scope ?? "");
    if (def) {
      const state = ensureResumed(scopeEl, def);
      const handler = def.on?.[action];
      if (handler) {
        handler({ root: scopeEl, el, state }, event);
        return;
      }
    }
    scopeEl = scopeEl.parentElement?.closest<HTMLElement>("[data-scope]") ?? null;
  }
}

function dispatch(type: string, event: Event): void {
  const el = (event.target as Element | null)?.closest<HTMLElement>(`[data-on-${type}]`);
  if (!el) return;
  const action = el.getAttribute(`data-on-${type}`);
  if (!action) return;
  runAction(action, el, event);
}

/** Bridge a native `CommandEvent` to the scope handler table. Only custom `--action` commands are
 * routed; built-in commands (`toggle-popover`, `show-modal`, …) carry no `--` prefix and are left
 * to the platform. The invoker (`event.source`) stands in for the `data-on-*` element. */
function dispatchCommand(event: Event): void {
  const command = (event as CommandEvent).command;
  if (!command || command.slice(0, 2) !== "--") return;
  // `source` is the invoker button (an HTMLElement) — stands in for the `data-on-*` element.
  const source = (event as CommandEvent).source as HTMLElement | null;
  if (!source) return;
  runAction(command.slice(2), source, event);
}

function hydrateState(raw: string | undefined): Record<string, Signal<unknown>> {
  const out: Record<string, Signal<unknown>> = {};
  if (!raw) return out;
  try {
    for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) {
      out[k] = createSignal(v);
    }
  } catch {
    console.warn("[resume] bad data-state");
  }
  return out;
}

// Re-export so scope authors bind effects without a second import.
export { effect };
