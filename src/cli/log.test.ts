import { afterEach, describe, expect, it } from "bun:test";
import { scopeLogger } from "./log";

describe("scopeLogger()", () => {
  const origLog = console.log;
  const origError = console.error;
  afterEach(() => {
    console.log = origLog;
    console.error = origError;
  });

  it("writes info lines as `[scope] msg` to console.log", () => {
    const lines: string[] = [];
    console.log = (msg: string) => lines.push(msg);
    scopeLogger("wasm").info("compiling");
    expect(lines).toEqual(["[wasm] compiling"]);
  });

  it("writes done lines as `[scope] msg` to console.log", () => {
    const lines: string[] = [];
    console.log = (msg: string) => lines.push(msg);
    scopeLogger("wasm").done("finished");
    expect(lines).toEqual(["[wasm] finished"]);
  });

  it("writes warn lines as `[scope] msg` to console.error", () => {
    const out: string[] = [];
    const err: string[] = [];
    console.log = (msg: string) => out.push(msg);
    console.error = (msg: string) => err.push(msg);
    scopeLogger("env").warn("missing binding");
    expect(err).toEqual(["[env] missing binding"]);
    expect(out).toEqual([]);
  });
});
