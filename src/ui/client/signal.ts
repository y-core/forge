interface Source {
  version: number;
  subs: Set<Consumer>;
  /** Optional because a writable signal cannot go stale on its own; only a derived value re-derives. */
  refresh?: () => void;
}

interface Consumer {
  deps: Map<Source, number>;
  disposed: boolean;
}

interface EffectNode extends Consumer {
  run: () => void;
}

interface DerivedNode extends Source, Consumer {
  refresh: () => void;
  computing: boolean;
}

/** A readable and writable reactive value; reading `.value` inside an effect subscribes to it. @public */
export interface Signal<T> {
  get value(): T;
  set value(v: T);
}

/** A signal exposing only its read side, as returned by `computed`. @public */
export interface ReadonlySignal<T> {
  get value(): T;
}

const NODE_RUN_CAP = 100;

let activeNode: Consumer | null = null;
let owner: Array<() => void> | null = null;
let flushing = false;
const pending = new Set<EffectNode>();

function cleanup(node: Consumer): void {
  for (const source of node.deps.keys()) source.subs.delete(node);
  node.deps.clear();
}

/** Subscribes the reading consumer to `source`, recording the version it observed. */
function track(source: Source): void {
  const node = activeNode;
  if (node === null || node.disposed) return;
  source.subs.add(node);
  node.deps.set(source, source.version);
}

/** Enqueues the effects behind `subs`, walking *through* derived nodes — only an effect holds a queue slot. */
function notify(subs: Set<Consumer>): void {
  for (const sub of subs) {
    if ("run" in sub) pending.add(sub as EffectNode);
    else notify((sub as DerivedNode).subs);
  }
}

/** Whether any source this consumer read has moved since it read it, re-deriving the derived ones to find out. */
function stale(node: Consumer): boolean {
  for (const [source, seen] of node.deps) {
    source.refresh?.();
    if (source.version !== seen) return true;
  }
  return false;
}

function flush(): void {
  if (flushing) return;
  flushing = true;
  // Flush-scoped by construction, so there is nothing to reset — and the budget measures one drain's
  // real work per node rather than the size of the graph it ran through.
  const runs = new Map<EffectNode, number>();
  // One node at a time, re-reading `pending` after each run rather than draining a snapshot: a
  // node enqueued mid-run must be able to run before the nodes queued behind it are re-checked,
  // which is what collapses a chain to one run of its shared reader.
  try {
    while (pending.size > 0) {
      const node = pending.values().next().value as EffectNode;
      pending.delete(node);
      if (node.disposed) {
        cleanup(node);
        continue;
      }
      // A write enqueues optimistically, because whether a derived value it feeds actually moved is
      // only knowable here, once every computed between them has had its chance to re-derive.
      if (!stale(node)) continue;
      const count = (runs.get(node) ?? 0) + 1;
      if (count > NODE_RUN_CAP) throw new Error(`signal: node run cap of ${NODE_RUN_CAP} exceeded in one flush — the graph is cyclic`);
      runs.set(node, count);
      node.run();
    }
  } finally {
    // A throw abandons the rest of the queue rather than carrying it into the next write, which
    // would run those effects against an unrelated caller's stack.
    flushing = false;
    pending.clear();
  }
}

/** Refuses a write from inside a reactive computation.
 *
 * This is what makes "an effect runs exactly once per settled state" a guarantee rather than a
 * discipline. Ordering by read-depth cannot fix the double run: the offending edge is a *write*
 * edge, invisible to the read graph and unknowable until the write happens. With no writes there is
 * no edge. Derive with `computed`, command from the `on` handler, and defer with `queueMicrotask`. */
function refuseReactiveWrite(): never {
  throw new Error(
    "signal: a signal was written while an effect or computed was running — effects paint, commands belong in the handler that caused them",
  );
}

/** Creates a reactive signal; reading inside an `effect` or `computed` automatically subscribes. @public */
export function createSignal<T>(initial: T): Signal<T> {
  let current = initial;
  const source: Source = { version: 0, subs: new Set() };

  return {
    get value() {
      track(source);
      return current;
    },
    set value(v: T) {
      // Before the equality check: a write that happens to match is still a write in the wrong place,
      // and letting it pass would make the rule depend on the value rather than on where it was made.
      if (activeNode !== null) refuseReactiveWrite();
      if (Object.is(current, v)) return;
      current = v;
      source.version += 1;
      notify(source.subs);
      if (flushing) return;
      flush();
    },
  };
}

/** Runs `fn` immediately, re-runs it whenever any signal read inside it changes, and returns a dispose function. @public */
export function effect(fn: () => void): () => void {
  const node: EffectNode = {
    disposed: false,
    deps: new Map(),
    run() {
      cleanup(node);
      const prev = activeNode;
      activeNode = node;
      // A throwing `fn` must not leave this node installed as the tracking target — reads outside
      // any effect would then subscribe a dead node.
      try {
        fn();
      } finally {
        activeNode = prev;
      }
    },
  };
  // A throw on the first run means the caller never receives the disposer, so any signal read
  // before it would keep this dead node subscribed and rethrow out of a later, unrelated write.
  try {
    node.run();
  } catch (err) {
    node.disposed = true;
    cleanup(node);
    throw err;
  }
  const dispose = () => {
    node.disposed = true;
    cleanup(node);
  };
  owner?.push(dispose);
  return dispose;
}

/** Derives a read-only signal, evaluated on read and re-derived only when a source it read has moved. @public */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
  let value = undefined as T;
  let evaluated = false;
  const node: DerivedNode = {
    version: 0,
    subs: new Set(),
    deps: new Map(),
    disposed: false,
    computing: false,
    refresh() {
      // Reading a computed from its own body is unbounded recursion once evaluation is pull-based,
      // where the eager model reached the run cap instead.
      if (node.computing) throw new Error("signal: a computed read its own value — the graph is cyclic");
      if (evaluated && !stale(node)) return;
      node.computing = true;
      const prev = activeNode;
      activeNode = node;
      try {
        cleanup(node);
        const next = fn();
        // The version moves only on a real change, which is what lets a consumer be dropped at
        // dequeue when the sources under this value moved but the value itself did not.
        if (!evaluated || !Object.is(value, next)) {
          value = next;
          node.version += 1;
        }
        evaluated = true;
      } finally {
        activeNode = prev;
        node.computing = false;
      }
    },
  };

  return {
    get value() {
      node.refresh();
      track(node);
      return value;
    },
  };
}

/** What `withOwner` returns: the callback's value, and a disposer for the effects it created. */
export interface OwnedRun<T> {
  result: T;
  dispose: () => void;
}

function disposeAll(disposers: Array<() => void>): void {
  for (const dispose of disposers) dispose();
}

/** Runs `fn` with an effect owner installed, returning its value and a disposer for every effect created inside it. */
export function withOwner<T>(fn: () => T): OwnedRun<T> {
  const collected: Array<() => void> = [];
  const previous = owner;
  owner = collected;
  try {
    return { result: fn(), dispose: () => disposeAll(collected) };
  } catch (error) {
    // A throwing `fn` never returns its disposer, so these effects are unreachable the instant it throws.
    disposeAll(collected);
    throw error;
  } finally {
    owner = previous;
  }
}
