/** Resumability-lite client runtime: one delegated listener resumes a `[data-scope]` on the first interaction with any descendant. @public */

import { SCOPE_EVENTS } from "../contracts/scope-events";
import { closestAcross, eventTarget, ownerDocument } from "./dom";
import { createSignal, effect, type Signal } from "./signal";

/** Context handed to a scope's `setup` and action handlers. @public */
export interface ResumeContext {
  /** The `[data-scope]` element enclosing the interaction. */
  root: HTMLElement;
  /** The element that fired the event (carries the `data-on-<event>` action). */
  el: HTMLElement;
  /** State rebuilt from `data-state` into reactive signals. */
  state: Record<string, Signal<unknown>>;
}

/** A registered scope: one-time setup plus a map of named action handlers. @public */
export interface ScopeDefinition<A extends string = string> {
  /** Resume at `resume()` time instead of waiting for the first interaction. */
  eager?: boolean;
  /** Binds DOM-mutating effects once on first resume, optionally returning a disposer. */
  // biome-ignore lint/suspicious/noConfusingVoidType: void in union is intentional — allows implicit-return setups
  setup?: (ctx: Omit<ResumeContext, "el">) => void | (() => void);
  /** Action handlers keyed by the `data-on-<event>` value. */
  on?: Record<A, (ctx: ResumeContext, event: Event) => void>;
}

const scopes = new Map<string, ScopeDefinition>();
const resumed = new WeakMap<HTMLElement, Record<string, Signal<unknown>>>();
/** Every currently-resumed scope root, mapped to the disposer its `setup` returned. Keyed by root so
 * one scope can be torn down alone, which is what an htmx swap needs. */
const active = new Map<HTMLElement, (() => void) | null>();

/** Registers a scope's setup and action handlers, keyed to a `data-scope` name. @public */
export function registerScope<A extends string = string>(name: string, def: ScopeDefinition<A>): void {
  scopes.set(name, { ...def, on: def.on ?? {} } as ScopeDefinition);
}

let teardown: (() => void) | null = null;

/** Installs one delegated listener per supported event and returns a disposer; idempotent. @public */
export function resume(within?: Node): () => void {
  if (teardown) return teardown;
  const doc = ownerDocument(within);
  const handlers: Array<[string, EventListener, boolean]> = [];
  for (const type of SCOPE_EVENTS) {
    const handler: EventListener = (event) => dispatch(type, event);
    doc.addEventListener(type, handler);
    handlers.push([type, handler, false]);
  }
  // The platform dispatches `command` with `bubbles:false`, so this must listen in the capture
  // phase — a bubble-phase delegated listener never sees it and every custom action goes dead.
  const commandHandler: EventListener = (event) => dispatchCommand(event);
  doc.addEventListener("command", commandHandler, { capture: true });
  handlers.push(["command", commandHandler, true]);
  teardown = () => {
    for (const [type, handler, capture] of handlers) doc.removeEventListener(type, handler, capture);
    for (const root of [...active.keys()]) disposeScope(root);
    teardown = null;
  };
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

/** The tree the eager pass scans: a document fragment or document is honoured as the walk root, anything else scans the whole document. */
function scanRoot(within: Node | undefined, doc: Document): ParentNode {
  const nodeType = within?.nodeType;
  return nodeType === 11 || nodeType === 9 ? (within as unknown as ParentNode) : doc;
}

/** Every `[data-scope]` at or below `root`, descending into open shadow roots. */
function findScopes(root: ParentNode): HTMLElement[] {
  const found: HTMLElement[] = [];
  // Breadth-first over a growing list rather than recursion — a shadow root nested inside a shadow
  // root is just another tree to visit, at any depth.
  const trees: ParentNode[] = [root];
  for (let i = 0; i < trees.length; i += 1) {
    const tree = trees[i];
    if (!tree) continue;
    // `querySelectorAll` reports descendants only, so a walk root carrying `data-scope` itself has
    // to be checked separately.
    const self = tree as Partial<HTMLElement>;
    if (self.dataset?.scope !== undefined) found.push(tree as HTMLElement);
    for (const el of tree.querySelectorAll<HTMLElement>("*")) {
      if (el.dataset.scope !== undefined) found.push(el);
      if (el.shadowRoot) trees.push(el.shadowRoot);
    }
  }
  return found;
}

/** Runs a scope's disposer and forgets that it was ever resumed. */
function disposeScope(root: HTMLElement): void {
  active.get(root)?.();
  active.delete(root);
  // Forgetting is half the job: a root left in `resumed` is skipped as already-resumed on a later
  // resume, and comes back inert.
  resumed.delete(root);
}

/** Disposes every scope whose root has left its document. */
function sweepDetached(): void {
  // An htmx swap detaches a scope's markup with no notice, so nothing else would ever run those
  // disposers; sweeping as the replacement resumes bounds the collection to live scopes.
  for (const root of [...active.keys()]) {
    if (!root.isConnected) disposeScope(root);
  }
}

/** Hydrates a scope's state into signals and runs its `setup` exactly once. */
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

/** Resumes a single scope now and returns its signal state, or `undefined` when its `data-scope` names no registered scope. @public */
export function resumeScope(root: HTMLElement): Record<string, Signal<unknown>> | undefined {
  const def = scopes.get(root.dataset.scope ?? "");
  return def ? ensureResumed(root, def) : undefined;
}

/** Walks up from `el` through `[data-scope]` ancestors and invokes the first scope whose `on` table owns `action`, resuming it on the way. */
function runAction(action: string, el: HTMLElement, event: Event): void {
  // `closestAcross`, not `closest`: a trigger inside a shadow root would otherwise never find the
  // scope root that encloses its host.
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
  // `eventTarget`, not `event.target`: an event that crossed a shadow boundary reports the host.
  const el = closestAcross<HTMLElement>(eventTarget(event) as Node | null, `[data-on-${type}]`);
  if (!el) return;
  const action = el.getAttribute(`data-on-${type}`);
  if (!action) return;
  runAction(action, el, event);
}

/** Bridges a native `CommandEvent` to the scope handler table, routing only custom `--action` commands. */
function dispatchCommand(event: Event): void {
  const command = (event as CommandEvent).command;
  if (command?.slice(0, 2) !== "--") return;
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

export { effect };
