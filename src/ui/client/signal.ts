interface EffectNode {
  run: () => void;
  deps: Set<Set<EffectNode>>;
  disposed: boolean;
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

const RUN_CAP = 10_000;

let activeEffect: EffectNode | null = null;
let flushing = false;
const pending = new Set<EffectNode>();

function cleanup(node: EffectNode): void {
  for (const dep of node.deps) dep.delete(node);
  node.deps.clear();
}

function flush(): void {
  if (flushing) return;
  flushing = true;
  let runs = 0;
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
      if (runs >= RUN_CAP) throw new Error(`signal: effect run cap of ${RUN_CAP} exceeded in one flush — the graph is cyclic`);
      runs++;
      node.run();
    }
  } finally {
    // A throw abandons the rest of the queue rather than carrying it into the next write, which
    // would run those effects against an unrelated caller's stack.
    flushing = false;
    pending.clear();
  }
}

/** Creates a reactive signal; reading inside an `effect` or `computed` automatically subscribes. @public */
export function createSignal<T>(initial: T): Signal<T> {
  let _value = initial;
  const subs = new Set<EffectNode>();

  return {
    get value() {
      if (activeEffect !== null && !activeEffect.disposed) {
        subs.add(activeEffect);
        activeEffect.deps.add(subs);
      }
      return _value;
    },
    set value(v: T) {
      if (Object.is(_value, v)) return;
      _value = v;
      for (const sub of subs) pending.add(sub);
      if (flushing) return;
      flush();
    },
  };
}

/** Runs `fn` immediately, re-runs it whenever any signal read inside it changes, and returns a dispose function. @public */
export function effect(fn: () => void): () => void {
  const node: EffectNode = {
    disposed: false,
    deps: new Set(),
    run() {
      cleanup(node);
      const prev = activeEffect;
      activeEffect = node;
      // A throwing `fn` must not leave this node installed as the tracking target — reads outside
      // any effect would then subscribe a dead node.
      try {
        fn();
      } finally {
        activeEffect = prev;
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
  return () => {
    node.disposed = true;
    cleanup(node);
  };
}

/** Derives a read-only signal whose value is recomputed whenever its dependencies change. @public */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
  const s = createSignal<T>(undefined as T);
  effect(() => {
    s.value = fn();
  });
  return {
    get value() {
      return s.value;
    },
  };
}
