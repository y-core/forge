interface EffectNode {
  run: () => void;
  deps: Set<Set<EffectNode>>;
  lastEpoch: number;
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
      // A throwing subscriber must not strand `depth` above zero — that would freeze `epoch` and
      // silently stop every later write from notifying.
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

/** Runs `fn` immediately, re-runs it whenever any signal read inside it changes, and returns a dispose function. @public */
export function effect(fn: () => void): () => void {
  const node: EffectNode = {
    lastEpoch: -1,
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
