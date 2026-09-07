/** Newline-delimited JSON-RPC 2.0 over a pair of streams — the whole of MCP's stdio transport.
 *
 *  Hand-rolled rather than taken as a dependency: the protocol warden needs is a request id, a
 *  method name, a params object and a result, and forge adds no runtime dependency without a
 *  reason bigger than that. */

/** A JSON-RPC request or notification. @public */
export interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** A JSON-RPC response. @public */
export interface RpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** The JSON-RPC codes warden returns. @public */
export const RPC_ERRORS = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;

/** A successful response. @public */
export function ok(id: string | number | null, result: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, result };
}

/** A failed response. @public */
export function err(id: string | number | null, code: number, message: string, data?: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

/** Parses one line into a request, or returns the response that says why it could not. @public */
export function parseRequest(line: string): { request: RpcRequest } | { response: RpcResponse } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { response: err(null, RPC_ERRORS.parse, "invalid JSON") };
  }
  const value = parsed as Partial<RpcRequest> | null;
  if (value === null || typeof value !== "object" || typeof value.method !== "string") {
    return { response: err(null, RPC_ERRORS.invalidRequest, "not a JSON-RPC request") };
  }
  return {
    request: {
      jsonrpc: "2.0",
      ...(value.id === undefined ? {} : { id: value.id }),
      method: value.method,
      ...(value.params === undefined ? {} : { params: value.params }),
    },
  };
}

/** Splits a growing buffer into whole lines, returning the remainder. @public */
export function takeLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((line) => line.trim()).filter((line) => line !== ""), rest };
}

/** Serialises one response as the single line the transport expects. @public */
export function encode(response: RpcResponse): string {
  return `${JSON.stringify(response)}\n`;
}
