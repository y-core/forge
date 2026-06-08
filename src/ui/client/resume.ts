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

/** A registered scope: one-time setup plus a map of named action handlers.
 * @public
 **/
export interface ScopeDefinition {
  /** Bind DOM-mutating effects ONCE on first resume (no `el` — not tied to one event). */
  setup?: (ctx: Omit<ResumeContext, "el">) => void;
  /** Action handlers keyed by the `data-on-<event>` value. */
  on: Record<string, (ctx: ResumeContext, event: Event) => void>;
}

const scopes = new Map<string, ScopeDefinition>();
const resumed = new WeakMap<HTMLElement, Record<string, Signal<unknown>>>();
const EVENTS = ["click", "input", "change", "submit"] as const;

/** Registers a scope's setup + action handlers, keyed to a `data-scope` name.
 * @public
 **/
export function registerScope(name: string, def: ScopeDefinition): void {
  scopes.set(name, def);
}

let teardown: (() => void) | null = null;

/** Installs one delegated listener per supported event. Idempotent: a second call is a no-op
 *  and returns the same teardown. Returns a disposer that removes all listeners. @public */
export function resume(): () => void {
  if (teardown) return teardown; // already mounted — no duplicate listeners
  const handlers: Array<[string, EventListener]> = [];
  for (const type of EVENTS) {
    const handler: EventListener = (event) => dispatch(type, event);
    document.addEventListener(type, handler);
    handlers.push([type, handler]);
  }
  teardown = () => {
    for (const [type, handler] of handlers) document.removeEventListener(type, handler);
    teardown = null;
  };
  return teardown;
}

function dispatch(type: string, event: Event): void {
  const el = (event.target as Element | null)?.closest<HTMLElement>(`[data-on-${type}]`);
  if (!el) return;
  const action = el.getAttribute(`data-on-${type}`);
  const root = el.closest<HTMLElement>("[data-scope]");
  if (!action || !root) return;
  const def = scopes.get(root.dataset.scope ?? "");
  if (!def) return;

  let state = resumed.get(root);
  if (!state) {
    // First interaction with this scope → resume it.
    state = hydrateState(root.dataset.state);
    resumed.set(root, state);
    def.setup?.({ root, state });
  }
  def.on[action]?.({ root, el, state }, event);
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
