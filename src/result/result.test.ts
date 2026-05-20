import { describe, expect, it } from "bun:test";
import type { Result } from "./result";
import { result } from "./result";

describe("result — sync success", () => {
  it("returns [value, null] for a primitive", () => {
    expect(result(() => 42)).toEqual([42, null]);
  });

  it("returns [value, null] for an object", () => {
    const obj = { a: 1 };
    expect(result(() => obj)).toEqual([{ a: 1 }, null]);
  });

  it("returns [0, null] for falsy zero", () => {
    expect(result(() => 0)).toEqual([0, null]);
  });

  it("returns [empty string, null] for falsy empty string", () => {
    expect(result(() => "")).toEqual(["", null]);
  });

  it("returns [false, null] for falsy false", () => {
    expect(result(() => false)).toEqual([false, null]);
  });
});

describe("result — sync error", () => {
  it("returns [null, Error] for a thrown Error", () => {
    const err = new Error("boom");
    const [data, error] = result(() => {
      throw err;
    });
    expect(data).toBeNull();
    expect(error).toBe(err);
  });

  it("returns [null, Error] for a thrown string", () => {
    const [data, error] = result(() => {
      throw "oops";
    });
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe("oops");
  });

  it("returns [null, Error] for thrown undefined", () => {
    const [data, error] = result(() => {
      throw undefined;
    });
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe("undefined");
  });

  it("returns [null, Error] for thrown null", () => {
    const [data, error] = result(() => {
      throw null;
    });
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe("null");
  });
});

describe("result — async success", () => {
  it("resolves to [value, null] for an async function", async () => {
    const [data, error] = await result(async () => "hello");
    expect(data).toBe("hello");
    expect(error).toBeNull();
  });

  it("resolves to [value, null] for a promise-returning function", async () => {
    const [data, error] = await result(() => Promise.resolve(99));
    expect(data).toBe(99);
    expect(error).toBeNull();
  });
});

describe("result — async error", () => {
  it("resolves to [null, Error] for a rejected promise", async () => {
    const err = new Error("async fail");
    const [data, error] = await result(() => Promise.reject(err));
    expect(data).toBeNull();
    expect(error).toBe(err);
  });

  it("resolves to [null, Error] for an async throw", async () => {
    const [data, error] = await result(async () => {
      throw new Error("async throw");
    });
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe("async throw");
  });
});

describe("result — bare promise", () => {
  it("resolves to [value, null] for a bare resolved promise", async () => {
    const [data, error] = await result(Promise.resolve("bare"));
    expect(data).toBe("bare");
    expect(error).toBeNull();
  });

  it("resolves to [null, Error] for a bare rejected promise", async () => {
    const err = new Error("bare reject");
    const [data, error] = await result(Promise.reject(err));
    expect(data).toBeNull();
    expect(error).toBe(err);
  });
});

describe("result — error coercion", () => {
  it("wraps thrown number with new Error(String(x))", () => {
    const [, error] = result(() => {
      throw 404;
    });
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe("404");
  });

  it("wraps thrown object with new Error(String(x))", () => {
    const [, error] = result(() => {
      throw { code: 1 };
    });
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe("[object Object]");
  });

  it("preserves Error instances without wrapping", () => {
    const original = new TypeError("type err");
    const [, error] = result(() => {
      throw original;
    });
    expect(error).toBe(original);
  });
});

describe("result — type narrowing", () => {
  it("narrows data to null when err is non-null", () => {
    const r: Result<string> = [null, new Error("x")];
    const [data, err] = r;
    if (err !== null) {
      const _: null = data;
      expect(_).toBeNull();
    }
  });

  it("narrows data to T when err is null", () => {
    const r: Result<string> = ["ok", null];
    const [data, err] = r;
    if (err === null) {
      const _: string = data;
      expect(_).toBe("ok");
    }
  });
});
