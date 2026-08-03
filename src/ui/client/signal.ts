interface EffectNode {
  run: () => void;
  deps: Set<Set<EffectNode>>;
  lastEpoch: number;
}

export interface Signal<T> {
  get value(): T;
  set value(v: T);
}

export interface ReadonlySignal<T> {
  get value(): T;
}

let activeEffect: EffectNode | null = null;
let epoch = 0;
let depth = 0;

function cleanup(node: EffectNode): void {
  for (const dep of node.deps) dep.delete(node);
  node.deps.clear();
}

/** Creates a reactive signal; reading inside an `effect` or `computed` automatically subscribes. @public */
export function createSignal<T>(initial: T): Signal<T> {
  let _value = initial;
  const subs = new Set<EffectNode>();

  return {
    get value() {
      if (activeEffect) {
        subs.add(activeEffect);
        activeEffect.deps.add(subs);
      }
      return _value;
    },
    set value(v: T) {
      if (Object.is(_value, v)) return;
      _value = v;
      if (depth === 0) epoch++;
      depth++;
      // a throwing subscriber must not strand `depth` above zero — that would
      // freeze `epoch` and silently stop every later write from notifying
      try {
        for (const sub of [...subs]) {
          if (sub.lastEpoch < epoch) {
            sub.lastEpoch = epoch;
            sub.run();
          }
        }
      } finally {
        depth--;
      }
    },
  };
}

/**
 * Runs `fn` immediately and re-runs it whenever any signal read inside it changes. Returns a
 * dispose function. @public
 *
 * @remarks
 * A `fn` that throws on its **first** run propagates the throw — callers may rely on that — but
 * leaves nothing subscribed. Without the unsubscribe there is no way to clean up: the disposer is
 * the return value, and a throw means the caller never receives it. Every signal read before the
 * throw would keep this node in its `subs` forever, so each later write to that signal re-enters
 * `run()` and rethrows out of the setter, at an unrelated call site. A throw on a *later* run is a
 * different case and is left alone: the caller already holds the disposer.
 */
export function effect(fn: () => void): () => void {
  const node: EffectNode = {
    lastEpoch: -1,
    deps: new Set(),
    run() {
      cleanup(node);
      const prev = activeEffect;
      activeEffect = node;
      // a throwing `fn` must not leave this node installed as the tracking
      // target — reads outside any effect would then subscribe a dead node
      try {
        fn();
      } finally {
        activeEffect = prev;
      }
    },
  };
  // The first run's own `cleanup` is a no-op — `deps` is still empty when it runs — so a read that
  // happened before the throw has already registered this node with that signal. Undo it here,
  // because the disposer that would otherwise do so never reaches the caller on this path.
  try {
    node.run();
  } catch (err) {
    cleanup(node);
    throw err;
  }
  return () => cleanup(node);
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
