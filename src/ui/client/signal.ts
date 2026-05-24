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
      for (const sub of [...subs]) {
        if (sub.lastEpoch < epoch) {
          sub.lastEpoch = epoch;
          sub.run();
        }
      }
      depth--;
    },
  };
}

/** Runs `fn` immediately and re-runs it whenever any signal read inside it changes. Returns a dispose function. @public */
export function effect(fn: () => void): () => void {
  const node: EffectNode = {
    lastEpoch: -1,
    deps: new Set(),
    run() {
      cleanup(node);
      const prev = activeEffect;
      activeEffect = node;
      fn();
      activeEffect = prev;
    },
  };
  node.run();
  return () => cleanup(node);
}

/** Derives a read-only signal whose value is recomputed whenever its dependencies change. @public */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
  const s = createSignal<T>(undefined as T);
  effect(() => {
    s.value = fn();
  });
  return { get value() { return s.value; } };
}
