import type { Knowledge } from "../index/open";
import { openIndex } from "../index/open";
import { resolveRepoRoot } from "../paths";
import { resolveKind } from "../sync/kind";
import type { Tree } from "../types";
import { canonVersion } from "../version";
import { RESOURCES, readResource, TEMPLATES } from "./resources";
import { encode, err, ok, parseRequest, RPC_ERRORS, type RpcResponse, takeLines } from "./rpc";
import { callTool, TOOLS } from "./tools";

const PROTOCOL_VERSION = "2024-11-05";

/** A minimal readable/writable pair, so `serve` can be driven by a test as well as by stdio. @public */
export interface Transport {
  read(): AsyncIterable<string>;
  write(line: string): void;
}

/** Answers one request. Exported so a test can drive the protocol without a process. @public */
export function handle(knowledge: Knowledge, method: string, params: Record<string, unknown>, id: string | number | null): RpcResponse | undefined {
  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: { subscribe: false, listChanged: false } },
        serverInfo: { name: "warden", version: canonVersion() },
      });

    // A notification carries no id and earns no response.
    case "notifications/initialized":
      return undefined;

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, { tools: TOOLS });

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      return ok(id, callTool(knowledge, name, args));
    }

    case "resources/list":
      return ok(id, { resources: RESOURCES });

    case "resources/templates/list":
      return ok(id, { resourceTemplates: TEMPLATES });

    case "resources/read": {
      const uri = typeof params.uri === "string" ? params.uri : "";
      const contents = readResource(knowledge, uri);
      return contents === undefined ? err(id, RPC_ERRORS.invalidParams, `no resource at "${uri}"`) : ok(id, contents);
    }

    default:
      return err(id, RPC_ERRORS.methodNotFound, `unknown method "${method}"`);
  }
}

/** Runs the protocol loop over `transport`.
 *
 *  **stdout carries protocol and nothing else**, and that is defended three ways because one is not
 *  enough: `console.log` and `console.info` are reassigned to `console.error` here, as the first
 *  statement; warden's own logging writes to stderr rather than through `scopeLogger`, which does
 *  not; and a unit test drives this loop with an in-memory pair asserting every stdout line parses
 *  as JSON-RPC. One stray `console.log` from any module in the import graph corrupts the stream and
 *  the host reports it as a protocol error with no clue where it came from. @public */
export async function serve(transport: Transport, knowledge: Knowledge): Promise<void> {
  console.log = console.error;
  console.info = console.error;

  let buffer = "";
  for await (const piece of transport.read()) {
    buffer += piece;
    const { lines, rest } = takeLines(buffer);
    buffer = rest;
    for (const line of lines) {
      const parsed = parseRequest(line);
      if ("response" in parsed) {
        transport.write(encode(parsed.response));
        continue;
      }
      const { request } = parsed;
      const id = request.id ?? null;
      try {
        const response = handle(knowledge, request.method, request.params ?? {}, id);
        // A notification is answered with silence, which is what the protocol requires.
        if (response !== undefined && request.id !== undefined) transport.write(encode(response));
      } catch (error) {
        if (request.id !== undefined) transport.write(encode(err(id, RPC_ERRORS.internal, error instanceof Error ? error.message : String(error))));
      }
    }
  }
}

/** Opens the index and serves it over stdio. @public */
export async function serveStdio(options: { root?: string; kind?: string } = {}): Promise<void> {
  console.log = console.error;
  console.info = console.error;

  const root = resolveRepoRoot(options.root);
  const kind: Tree = resolveKind(root, options.kind);
  const knowledge = openIndex(root, kind, { canonVersion: canonVersion() });

  const transport: Transport = {
    read: () => stdinLines(),
    write: (line) => {
      process.stdout.write(line);
    },
  };

  try {
    await serve(transport, knowledge);
  } finally {
    knowledge.close();
  }
}

async function* stdinLines(): AsyncIterable<string> {
  const decoder = new TextDecoder();
  for await (const chunk of Bun.stdin.stream()) yield decoder.decode(chunk as Uint8Array, { stream: true });
}
