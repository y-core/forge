import { describe, expect, it } from "bun:test";

import { encode, err, ok, parseRequest, RPC_ERRORS, takeLines } from "./rpc";

describe("parseRequest()", () => {
  it("reads a request with an id and params", () => {
    expect(parseRequest('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x"}}')).toEqual({
      request: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x" } },
    });
  });

  it("reads a notification, which carries no id", () => {
    expect(parseRequest('{"jsonrpc":"2.0","method":"notifications/initialized"}')).toEqual({
      request: { jsonrpc: "2.0", method: "notifications/initialized" },
    });
  });

  it("answers unparseable JSON with a parse error rather than throwing", () => {
    const parsed = parseRequest("{not json");

    expect("response" in parsed && parsed.response.error?.code).toBe(RPC_ERRORS.parse);
  });

  it("answers a well-formed object that is not a request", () => {
    for (const line of ["null", "[]", '{"id":1}', '{"method":7}']) {
      const parsed = parseRequest(line);

      expect("response" in parsed && parsed.response.error?.code).toBe(
        line === "null" || line === "[]" ? RPC_ERRORS.invalidRequest : RPC_ERRORS.invalidRequest,
      );
    }
  });
});

describe("takeLines()", () => {
  it("returns whole lines and keeps the partial one", () => {
    expect(takeLines('{"a":1}\n{"b":2}\n{"c"')).toEqual({ lines: ['{"a":1}', '{"b":2}'], rest: '{"c"' });
  });

  it("drops blank lines rather than parsing them", () => {
    expect(takeLines('\n\n{"a":1}\n').lines).toEqual(['{"a":1}']);
  });

  it("returns nothing while no line is complete", () => {
    expect(takeLines('{"a"')).toEqual({ lines: [], rest: '{"a"' });
  });
});

describe("encode()", () => {
  it("writes one line, newline-terminated, that parses back as JSON", () => {
    const line = encode(ok(1, { done: true }));

    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({ jsonrpc: "2.0", id: 1, result: { done: true } });
  });

  it("omits `data` when there is none, rather than writing undefined", () => {
    expect(JSON.parse(encode(err(1, -32601, "nope")))).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "nope" } });
  });
});
