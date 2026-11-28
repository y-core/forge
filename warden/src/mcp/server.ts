import { stdin } from "bun";

import type { Knowledge } from "../index/open";
import { openIndex } from "../index/open";
import { resolveRepoRoot } from "../paths";
import { loadSteps, type StepSummary } from "../sdk/data";
import { resolveKind } from "../sync/kind";
import type { Tree } from "../types";
import { canonVersion } from "../version";
import { RESOURCES, readResource, TEMPLATES } from "./resources";
import { encode, err, ok, parseRequest, RPC_ERRORS, type RpcRequest, type RpcResponse, takeLines } from "./rpc";
import { callTool, knowledgeTools } from "./tools";

const PROTOCOL_VERSION = "2024-11-05";

/** The methods that answer from the corpus, and so must see it as it stands now. */
const SERVES_CONTENT = new Set(["tools/call", "resources/read", "tools/list"]);

/** A minimal readable/writable pair, so `serve` can be driven by a test as well as by stdio. @public */
export interface Transport {
  read(): AsyncIterable<string>;
  write(line: string): void;
}

/** Answers one request, refreshing the index first where the method serves content. @public */
export async function handle(
  knowledge: Knowledge,
  method: string,
  params: Record<string, unknown>,
  id: string | number | null,
  steps: readonly StepSummary[] = [],
): Promise<RpcResponse | undefined> {
  if (SERVES_CONTENT.has(method)) knowledge.refresh();

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
      return ok(id, { tools: knowledgeTools(knowledge) });

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      return ok(id, await callTool(knowledge, name, args, steps));
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

/** Runs the protocol loop over `transport`. @public */
export async function serve(transport: Transport, knowledge: Knowledge, steps: readonly StepSummary[] = []): Promise<void> {
  // stdout carries JSON-RPC and nothing else: one stray `console.log` anywhere in the import graph
  // corrupts the stream, and the host reports it as a protocol error naming no source.
  console.log = console.error;
  console.info = console.error;

  // Each request is answered when it settles, not in arrival order: a slow `warden_query` holds back
  // only its own response, and the id is what pairs a response with its request.
  const pending = new Set<Promise<void>>();
  const answer = async (request: RpcRequest): Promise<void> => {
    const id = request.id ?? null;
    try {
      const response = await handle(knowledge, request.method, request.params ?? {}, id, steps);
      if (response !== undefined && request.id !== undefined) transport.write(encode(response));
    } catch (error) {
      if (request.id !== undefined) transport.write(encode(err(id, RPC_ERRORS.internal, error instanceof Error ? error.message : String(error))));
    }
  };

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
      const task = answer(parsed.request).finally(() => pending.delete(task));
      pending.add(task);
    }
  }
  // The caller closes the index once this returns, so every request still running finishes first.
  await Promise.all(pending);
}

/** Opens the index and serves it over stdio. @public */
export async function serveStdio(options: { root?: string; kind?: string; dependency?: boolean } = {}): Promise<void> {
  console.log = console.error;
  console.info = console.error;

  const root = resolveRepoRoot(options.root);
  const kind: Tree = resolveKind(root, options.kind);
  const knowledge = openIndex(root, kind, { canonVersion: canonVersion(), dependency: options.dependency === true });

  const transport: Transport = {
    read: () => stdinLines(),
    write: (line) => {
      process.stdout.write(line);
    },
  };

  // Read once: a step table is code, so the rows are loaded before the first request rather than per query.
  const steps = await loadSteps(root);
  try {
    await serve(transport, knowledge, steps.ok ? steps.data : []);
  } finally {
    knowledge.close();
  }
}

async function* stdinLines(): AsyncIterable<string> {
  const decoder = new TextDecoder();
  for await (const chunk of stdin.stream()) yield decoder.decode(chunk as Uint8Array, { stream: true });
}
