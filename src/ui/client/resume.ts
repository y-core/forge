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

import { SCOPE_EVENTS } from "../contracts/scope-events";
import { closestAcross, eventTarget, ownerDocument } from "./dom";
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
/** Every currently-resumed scope root, mapped to the disposer its `setup` returned (`null` when it
 * returned none). Keyed by root rather than kept as a flat list so one scope can be torn down on its
 * own, which is what an htmx swap needs: the markup it replaces takes its scope with it. */
const active = new Map<HTMLElement, (() => void) | null>();

/** Registers a scope's setup + action handlers, keyed to a `data-scope` name. Generic over the
 * action-name union `A`, inferred from the `on` object literal.
 * @public
 **/
export function registerScope<A extends string = string>(name: string, def: ScopeDefinition<A>): void {
  scopes.set(name, { ...def, on: def.on ?? {} } as ScopeDefinition);
}

let teardown: (() => void) | null = null;

/** Installs one delegated listener per supported event. Idempotent: a second call is a no-op
 *  and returns the same teardown. Returns a disposer that removes all listeners.
 *
 *  `within` names any node in the document to mount on; omit it for the top-level page. It exists so
 *  an app rendered inside an iframe mounts on **its own** document — a bare `document` here would
 *  install the listeners on the wrong realm and every scope would go dead without an error.
 *
 *  Pass a `ShadowRoot` to scan only that subtree, which is what a web component wants when it
 *  resumes its own markup. The delegated listeners still go on the containing document either way:
 *  the events they wait for are composed, so they cross the boundary on their own. @public */
export function resume(within?: Node): () => void {
  if (teardown) return teardown; // already mounted — no duplicate listeners
  const doc = ownerDocument(within);
  const handlers: Array<[string, EventListener, boolean]> = [];
  for (const type of SCOPE_EVENTS) {
    const handler: EventListener = (event) => dispatch(type, event);
    doc.addEventListener(type, handler);
    handlers.push([type, handler, false]);
  }
  // Native Invoker Commands bridge: one delegated `command` listener routes custom `--action`
  // commands into the same scope handler table the `data-on-*` events feed. Built-in commands
  // (no `--` prefix) are left to the platform. Companion to the SCOPE_EVENTS listeners above.
  // The platform dispatches `command` with `bubbles:false`, so this listener runs in the capture
  // phase — a bubble-phase delegated listener never sees it and every custom action goes dead.
  const commandHandler: EventListener = (event) => dispatchCommand(event);
  doc.addEventListener("command", commandHandler, { capture: true });
  handlers.push(["command", commandHandler, true]);
  teardown = () => {
    for (const [type, handler, capture] of handlers) doc.removeEventListener(type, handler, capture);
    for (const root of [...active.keys()]) disposeScope(root);
    teardown = null;
  };
  // Eager pass: scopes that opt out of lazy resume are hydrated immediately. An element whose
  // `data-scope` names no registered definition is always a bug — the app forgot to
  // side-effect-import the client module that registers it. Warn once per unknown name.
  const warnedUnknown = new Set<string>();
  for (const el of findScopes(scanRoot(within, doc))) {
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

/** The tree the eager pass scans. A `ShadowRoot` (or any document fragment) is honoured as the walk
 * root so a web component can resume only its own markup; anything else scans the whole document,
 * which is what `within` has always meant for the listeners. */
function scanRoot(within: Node | undefined, doc: Document): ParentNode {
  const nodeType = within?.nodeType;
  return nodeType === 11 || nodeType === 9 ? (within as unknown as ParentNode) : doc;
}

/**
 * Every `[data-scope]` at or below `root`, descending into open shadow roots.
 *
 * A flat `querySelectorAll` stops at a shadow boundary, so a scope rendered inside a web component
 * was never discovered: the markup was there, its definition was registered, and nothing forge adds
 * to it ever ran — no arrow navigation, no typeahead, no focus restoration, and no warning either,
 * because the element was never visited. The delegated half never had this problem, because
 * `closestAcross` climbs out through `host`.
 *
 * Shadow hosts are not addressable by a selector, so each tree has to be looked at element by
 * element. A closed root reports `shadowRoot === null` and is stepped over, which is the same answer
 * the platform gives everywhere else.
 *
 * Private on purpose: only discovery needs it, and a second exported traversal helper would be
 * public surface with one caller.
 */
function findScopes(root: ParentNode): HTMLElement[] {
  const found: HTMLElement[] = [];
  // Breadth-first over a growing list rather than recursion — a shadow root nested inside a shadow
  // root is just another tree to visit, at any depth.
  const trees: ParentNode[] = [root];
  for (let i = 0; i < trees.length; i += 1) {
    const tree = trees[i];
    if (!tree) continue;
    // A `ShadowRoot` handed in as the walk root can itself be a host's scope element's parent, but
    // the host's own subtree root may carry `data-scope`; `querySelectorAll` reports descendants only.
    const self = tree as Partial<HTMLElement>;
    if (self.dataset?.scope !== undefined) found.push(tree as HTMLElement);
    for (const el of tree.querySelectorAll<HTMLElement>("*")) {
      if (el.dataset.scope !== undefined) found.push(el);
      if (el.shadowRoot) trees.push(el.shadowRoot);
    }
  }
  return found;
}

/**
 * Runs a scope's disposer and forgets that it was ever resumed.
 *
 * Forgetting is half the job: leaving the root in `resumed` after its disposer has run means a later
 * resume of that same root is skipped as already-resumed, so `setup` never re-binds and the scope
 * comes back inert.
 */
function disposeScope(root: HTMLElement): void {
  active.get(root)?.();
  active.delete(root);
  resumed.delete(root);
}

/**
 * Disposes every scope whose root has left its document.
 *
 * An htmx swap detaches a scope's markup with no notice to this module. Nothing else would ever run
 * those disposers, so each swap would strand one more detached tree, its `MutationObserver`s and its
 * listeners for the life of the page — and the entry pinning them would keep the tree itself alive.
 * Sweeping as the replacement scope resumes is what bounds the collection to the live scopes.
 */
function sweepDetached(): void {
  for (const root of [...active.keys()]) {
    if (!root.isConnected) disposeScope(root);
  }
}

/** Hydrates a scope's state into signals and runs its `setup` exactly once. Idempotent: a
 * second call returns the already-built state without re-running `setup`. */
function ensureResumed(root: HTMLElement, def: ScopeDefinition): Record<string, Signal<unknown>> {
  sweepDetached();
  let state = resumed.get(root);
  if (!state) {
    state = hydrateState(root.dataset.state);
    resumed.set(root, state);
    const dispose = def.setup?.({ root, state });
    active.set(root, typeof dispose === "function" ? dispose : null);
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
  // `closestAcross`, not `closest`: a trigger inside a shadow root would otherwise never find the
  // scope root that encloses its host, and the action would silently do nothing.
  let scopeEl = closestAcross<HTMLElement>(el, "[data-scope]");
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
    scopeEl = closestAcross<HTMLElement>(scopeEl.parentNode, "[data-scope]");
  }
}

function dispatch(type: string, event: Event): void {
  // `eventTarget`, not `event.target`: an event that crossed a shadow boundary reports the host,
  // so a `data-on-*` element inside a web component would never be found.
  const el = closestAcross<HTMLElement>(eventTarget(event) as Node | null, `[data-on-${type}]`);
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
  if (command?.slice(0, 2) !== "--") return;
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
