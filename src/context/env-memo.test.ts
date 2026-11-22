import { describe, expect, it } from "bun:test";

import { RequestContext } from "@remix-run/fetch-router";

import { cachePendingUntilRejected, memoizePerEnv } from "./env-memo";
import { EnvKey } from "./types";

function contextUnder(env?: object): RequestContext {
  const context = new RequestContext(new Request("http://localhost/"));
  if (env !== undefined) context.set(EnvKey, env, { property: "env" });
  return context;
}

describe("memoizePerEnv()", () => {
  it("computes once per env object and once more for another", async () => {
    let calls = 0;
    const memo = memoizePerEnv(() => ++calls);
    const env = {};
    const values = [await memo(contextUnder(env)), await memo(contextUnder(env)), await memo(contextUnder({}))];
    expect({ values, calls }).toEqual({ values: [1, 1, 2], calls: 2 });
  });

  it("hands compute a view of the env it is keyed on, and nothing of the request", async () => {
    const seen: unknown[] = [];
    const memo = memoizePerEnv((env: { readonly NAME: string }) => {
      seen.push(env);
      return env.NAME;
    });
    const env = { NAME: "a" };
    expect({ value: await memo(contextUnder(env)), seen }).toEqual({ value: "a", seen: [env] });
  });

  it("retries after a rejection rather than caching it", async () => {
    let calls = 0;
    const memo = memoizePerEnv(() => {
      calls++;
      if (calls === 1) throw new Error("transient");
      return "ready";
    });
    const env = {};
    await expect(memo(contextUnder(env))).rejects.toThrow("transient");
    expect(await memo(contextUnder(env))).toBe("ready");
  });

  it("computes once for two concurrent first calls under one env", async () => {
    let calls = 0;
    const memo = memoizePerEnv(async () => {
      calls++;
      await Promise.resolve();
      return calls;
    });
    const env = {};
    const values = await Promise.all([memo(contextUnder(env)), memo(contextUnder(env))]);
    expect({ values, calls }).toEqual({ values: [1, 1], calls: 1 });
  });

  it("caches a resolved value past a rejection under another env", async () => {
    let calls = 0;
    const memo = memoizePerEnv(() => {
      calls++;
      if (calls === 2) throw new Error("transient");
      return calls;
    });
    const steady = {};
    await memo(contextUnder(steady));
    await expect(memo(contextUnder({}))).rejects.toThrow("transient");
    expect({ value: await memo(contextUnder(steady)), calls }).toEqual({ value: 1, calls: 2 });
  });

  it("reports a synchronous throw as a rejection, with or without an env", async () => {
    const memo = memoizePerEnv(() => {
      throw new Error("sync failure");
    });
    const outcomes = await Promise.all(
      [contextUnder({}), contextUnder()].map((c) =>
        memo(c).then(
          () => "resolved",
          (err: Error) => `rejected: ${err.message}`,
        ),
      ),
    );
    expect(outcomes).toEqual(["rejected: sync failure", "rejected: sync failure"]);
  });

  it("computes on every call where the env is not an object", async () => {
    let calls = 0;
    const memo = memoizePerEnv(() => ++calls);
    const primitive = "env" as unknown as object;
    await memo(contextUnder(primitive));
    await memo(contextUnder(primitive));
    expect(calls).toBe(2);
  });

  it("computes on every call where the context carries no env", async () => {
    let calls = 0;
    const memo = memoizePerEnv(() => ++calls);
    await memo(contextUnder());
    await memo(contextUnder());
    expect(calls).toBe(2);
  });
});

describe("memoizePerEnv() — a resolver still written against the request context", () => {
  const HANDED_ENV = "this resolver is handed `env`, not the request context — rewrite `(c) => c.env.X` as `(env) => env.X`";
  // oxlint-disable-next-line typescript/no-explicit-any -- a 0.7.7 resolver typed against the context it is no longer handed
  type ContextResolver = (c: any) => unknown;
  const unconverted: { name: string; compute: ContextResolver }[] = [
    { name: "(c) => c.env.SECRET", compute: (c) => c.env.SECRET },
    { name: "(c) => c.get(EnvKey)", compute: (c) => c.get(EnvKey) },
    { name: "({ env }) => env", compute: ({ env }) => env },
  ];

  for (const { name, compute } of unconverted) {
    it(`rejects ${name} on the first call, naming the rewrite`, async () => {
      await expect(memoizePerEnv(compute)(contextUnder({ SECRET: "s" }))).rejects.toThrow(new Error(HANDED_ENV));
    });
  }

  it("lets a real binding named env or get through", async () => {
    const memo = memoizePerEnv((env: { readonly env: string; readonly get: string }) => `${env.env}/${env.get}`);
    expect(await memo(contextUnder({ env: "production", get: "a binding" }))).toBe("production/a binding");
  });

  it("lets a binding's method run against its own binding when read through the view", async () => {
    const kv = {
      data: new Map([["k", "v"]]),
      get(key: string) {
        return this.data.get(key);
      },
    };
    const memo = memoizePerEnv((env: { readonly KV: typeof kv }) => env.KV.get("k"));
    expect(await memo(contextUnder({ KV: kv }))).toBe("v");
  });

  it("resolves a correct resolver once per env object across requests, and once more for another", async () => {
    let calls = 0;
    const memo = memoizePerEnv((env: { readonly SECRET: string }) => {
      calls++;
      return env.SECRET;
    });
    const env = { SECRET: "a" };
    const values = [
      await memo(contextUnder(env)),
      await memo(contextUnder(env)),
      await memo(contextUnder(env)),
      await memo(contextUnder({ SECRET: "b" })),
    ];
    expect({ values, calls }).toEqual({ values: ["a", "a", "a", "b"], calls: 2 });
  });

  it("hands a non-object env to compute as it is", async () => {
    const seen: unknown[] = [];
    const memo = memoizePerEnv((env: unknown) => seen.push(env));
    await memo(contextUnder());
    expect(seen).toEqual([undefined]);
  });
});

describe("cachePendingUntilRejected", () => {
  it("holds a pending promise under its key until it settles", () => {
    const cache = new Map<string, Promise<number>>();
    const pending = Promise.withResolvers<number>();
    expect(cachePendingUntilRejected(cache, "k", pending.promise)).toBe(pending.promise);
    expect(cache.get("k")).toBe(pending.promise);
    pending.resolve(1);
  });

  it("keeps a resolved promise cached", async () => {
    const cache = new Map<string, Promise<number>>();
    const resolved = Promise.resolve(7);
    expect(await cachePendingUntilRejected(cache, "k", resolved)).toBe(7);
    expect(cache.get("k")).toBe(resolved);
  });

  it("evicts a rejected promise, so the next lookup misses and the caller can retry", async () => {
    const cache = new Map<string, Promise<number>>();
    const rejected = cachePendingUntilRejected(cache, "k", Promise.reject(new Error("transient")));
    await expect(rejected).rejects.toThrow("transient");
    expect(cache.has("k")).toBe(false);
  });

  it("still hands the rejection to the caller that cached it", async () => {
    const cache = new Map<string, Promise<number>>();
    const failure = new Error("transient");
    const outcome = await cachePendingUntilRejected(cache, "k", Promise.reject(failure)).then(
      () => "resolved",
      (thrown: unknown) => thrown,
    );
    expect(outcome).toBe(failure);
  });

  it("leaves a newer entry in place when the older promise under the same key rejects", async () => {
    const cache = new Map<string, Promise<number>>();
    const older = Promise.withResolvers<number>();
    const stale = cachePendingUntilRejected(cache, "k", older.promise);
    const newer = Promise.resolve(2);
    cache.set("k", newer);
    older.reject(new Error("stale failure"));
    await expect(stale).rejects.toThrow("stale failure");
    expect(cache.get("k")).toBe(newer);
  });

  it("evicts from a WeakMap keyed on an object as it does from a Map", async () => {
    const cache = new WeakMap<object, Promise<number>>();
    const env = {};
    const rejected = cachePendingUntilRejected(cache, env, Promise.reject(new Error("transient")));
    await expect(rejected).rejects.toThrow("transient");
    expect(cache.has(env)).toBe(false);
  });
});
