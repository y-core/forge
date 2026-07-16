import { describe, expect, it } from "bun:test";
import type { GuardResult, Result, ValidationResult } from "./result";
import { err, ok, result, toError } from "./result";

describe("result — sync success", () => {
  it("returns { ok: true, data } for a primitive", () => {
    expect(result(() => 42)).toEqual({ ok: true, data: 42 });
  });

  it("returns { ok: true, data } for an object", () => {
    const obj = { a: 1 };
    expect(result(() => obj)).toEqual({ ok: true, data: { a: 1 } });
  });

  it("returns { ok: true, data: 0 } for falsy zero", () => {
    expect(result(() => 0)).toEqual({ ok: true, data: 0 });
  });

  it("returns { ok: true, data: '' } for falsy empty string", () => {
    expect(result(() => "")).toEqual({ ok: true, data: "" });
  });

  it("returns { ok: true, data: false } for falsy false", () => {
    expect(result(() => false)).toEqual({ ok: true, data: false });
  });
});

describe("result — sync error", () => {
  it("returns { ok: false, error } for a thrown Error", () => {
    const err = new Error("boom");
    const r = result(() => {
      throw err;
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(err);
  });

  it("returns { ok: false, error } for a thrown string", () => {
    const r = result(() => {
      throw "oops";
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(Error);
      expect(r.error.message).toBe("oops");
    }
  });

  it("returns { ok: false, error } for thrown undefined", () => {
    const r = result(() => {
      throw undefined;
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(Error);
      expect(r.error.message).toBe("undefined");
    }
  });

  it("returns { ok: false, error } for thrown null", () => {
    const r = result(() => {
      throw null;
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(Error);
      expect(r.error.message).toBe("null");
    }
  });
});

describe("result — async success", () => {
  it("resolves to { ok: true, data } for an async function", async () => {
    const r = await result(async () => "hello");
    expect(r).toEqual({ ok: true, data: "hello" });
  });

  it("resolves to { ok: true, data } for a promise-returning function", async () => {
    const r = await result(() => Promise.resolve(99));
    expect(r).toEqual({ ok: true, data: 99 });
  });
});

describe("result — async error", () => {
  it("resolves to { ok: false, error } for a rejected promise", async () => {
    const err = new Error("async fail");
    const r = await result(() => Promise.reject(err));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(err);
  });

  it("resolves to { ok: false, error } for an async throw", async () => {
    const r = await result(async () => {
      throw new Error("async throw");
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(Error);
      expect(r.error.message).toBe("async throw");
    }
  });
});

describe("result — bare promise", () => {
  it("resolves to { ok: true, data } for a bare resolved promise", async () => {
    const r = await result(Promise.resolve("bare"));
    expect(r).toEqual({ ok: true, data: "bare" });
  });

  it("resolves to { ok: false, error } for a bare rejected promise", async () => {
    const err = new Error("bare reject");
    const r = await result(Promise.reject(err));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(err);
  });
});

describe("result — error coercion", () => {
  it("wraps thrown number with new Error(String(x))", () => {
    const r = result(() => {
      throw 404;
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(Error);
      expect(r.error.message).toBe("404");
    }
  });

  it("wraps thrown object with new Error(String(x))", () => {
    const r = result(() => {
      throw { code: 1 };
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(Error);
      expect(r.error.message).toBe("[object Object]");
    }
  });

  it("preserves Error instances without wrapping", () => {
    const original = new TypeError("type err");
    const r = result(() => {
      throw original;
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(original);
  });
});

describe("result — type narrowing", () => {
  it("narrows to error branch on ok: false", () => {
    const r: Result<string> = { ok: false, error: new Error("x") };
    if (!r.ok) {
      const _: Error = r.error;
      expect(_).toBeInstanceOf(Error);
    }
  });

  it("narrows to data branch on ok: true", () => {
    const r: Result<string> = { ok: true, data: "hello" };
    if (r.ok) {
      const _: string = r.data;
      expect(_).toBe("hello");
    }
  });
});

describe("ok constructor", () => {
  it("returns { ok: true, data: undefined } when called with no argument", () => {
    expect(ok()).toEqual({ ok: true, data: undefined });
  });

  it("exposes an explicit undefined data property for the void overload", () => {
    const r = ok();
    expect(r.ok).toBe(true);
    expect("data" in r).toBe(true);
    if (r.ok) expect(r.data).toBeUndefined();
  });

  it("returns { ok: true, data } for a primitive", () => {
    expect(ok(42)).toEqual({ ok: true, data: 42 });
  });

  it("returns { ok: true, data } for an object", () => {
    const value = { a: 1 };
    const r = ok(value);
    expect(r).toEqual({ ok: true, data: { a: 1 } });
    if (r.ok) expect(r.data).toBe(value);
  });

  it("preserves falsy data values", () => {
    expect(ok(0)).toEqual({ ok: true, data: 0 });
    expect(ok("")).toEqual({ ok: true, data: "" });
    expect(ok(false)).toEqual({ ok: true, data: false });
    expect(ok(null)).toEqual({ ok: true, data: null });
  });
});

describe("err constructor", () => {
  it("returns { ok: false, error } for a reason-code string", () => {
    expect(err("cross-site")).toEqual({ ok: false, error: "cross-site" });
  });

  it("returns { ok: false, error } for a message list", () => {
    expect(err(["name is required"])).toEqual({ ok: false, error: ["name is required"] });
  });

  it("returns { ok: false, error } for an Error instance", () => {
    const boom = new Error("boom");
    const r = err(boom);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(boom);
  });
});

describe("GuardResult / ValidationResult narrowing", () => {
  it("narrows a GuardResult failure to its reason code via .ok", () => {
    const g: GuardResult<"missing" | "cross-site"> = err("missing");
    expect(g.ok).toBe(false);
    if (!g.ok) {
      const reason: "missing" | "cross-site" = g.error;
      expect(reason).toBe("missing");
    }
  });

  it("narrows a passing GuardResult to its void success branch via .ok", () => {
    const g: GuardResult = ok();
    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.data).toBeUndefined();
    }
  });

  it("exposes .error as a readonly string[] on a ValidationResult failure", () => {
    const v: ValidationResult<{ name: string }> = err(["name is required", "name too short"]);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const messages: readonly string[] = v.error;
      expect(messages).toEqual(["name is required", "name too short"]);
    }
  });

  it("narrows a ValidationResult success to its data via .ok", () => {
    const v: ValidationResult<{ name: string }> = ok({ name: "Jane" });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.data.name).toBe("Jane");
  });
});

describe("toError", () => {
  it("returns an Error instance unchanged", () => {
    const err = new Error("original");
    expect(toError(err)).toBe(err);
  });

  it("wraps a thrown string into an Error with that message", () => {
    const err = toError("plain string failure");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("plain string failure");
  });

  it("wraps a non-string, non-Error value into an Error", () => {
    const err = toError({ code: 42 });
    expect(err).toBeInstanceOf(Error);
    expect(typeof err.message).toBe("string");
  });
});
