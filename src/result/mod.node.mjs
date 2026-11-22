// Generated from src/result/mod.ts by `bun run gen:bundles` — do not edit.

// src/result/result.ts
function toError(thrown) {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}
function ok(data) {
  return { ok: true, data };
}
function err(error) {
  return { ok: false, error };
}
function result(arg) {
  if (typeof arg === "function") {
    let val;
    try {
      val = arg();
    } catch (thrown) {
      return { ok: false, error: toError(thrown) };
    }
    if (val instanceof Promise) {
      return val.then(
        (data) => ({ ok: true, data }),
        (thrown) => ({ ok: false, error: toError(thrown) })
      );
    }
    return { ok: true, data: val };
  }
  return arg.then(
    (data) => ({ ok: true, data }),
    (thrown) => ({ ok: false, error: toError(thrown) })
  );
}
export {
  err,
  ok,
  result,
  toError
};
