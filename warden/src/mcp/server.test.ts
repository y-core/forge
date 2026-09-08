import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { openIndex } from "../index/open";
import type { Knowledge } from "../index/open";
import { search } from "../search/search";
import { handle, serve, type Transport } from "./server";

const DOC =
  '---\ntitle: Rules\ndescription: "One."\n---\n\n## 0. Quick Reference\n\n- §1 One: the comment budget\n\n## 1. One\n\nThe comment budget is a ceiling.\n';

function served(): { index: Knowledge; root: string } {
  const root = mkdtempSync(join(tmpdir(), "warden-mcp-"));
  const canonRoot = join(root, "canon");
  for (const path of [join(root, "docs/A.md"), join(canonRoot, "libs/CODE_RULES.md"), join(canonRoot, "shared/AGENT_GUIDE.md")]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, DOC, "utf-8");
  }
  return { index: openIndex(root, "libs", { path: ":memory:", canonRoot, canonVersion: "1.0.0" }), root };
}

function knowledge(): Knowledge {
  return served().index;
}

/** An in-memory transport: `lines` are fed in, everything written is captured. */
function pair(lines: readonly string[]): { transport: Transport; out: string[] } {
  const out: string[] = [];
  return {
    out,
    transport: {
      // Fed one chunk per line, and one split mid-line, so reassembly is exercised too.
      read: async function* () {
        for (const line of lines) {
          yield line.slice(0, 3);
          yield `${line.slice(3)}\n`;
        }
      },
      write: (line) => out.push(line),
    },
  };
}

const request = (id: number | null, method: string, params?: Record<string, unknown>) =>
  JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, ...(params === undefined ? {} : { params }) });

describe("handle()", () => {
  const index = knowledge();

  it("answers initialize with a protocol version and the two capabilities warden has", () => {
    const result = handle(index, "initialize", {}, 1)?.result as { protocolVersion: string; capabilities: unknown } | undefined;

    expect(result?.protocolVersion).toBe("2024-11-05");
    expect(result?.capabilities).toEqual({ tools: {}, resources: { subscribe: false, listChanged: false } });
  });

  it("answers a notification with nothing at all", () => {
    expect(handle(index, "notifications/initialized", {}, null)).toBeUndefined();
  });

  it("lists the five tools and the resources", () => {
    const tools = handle(index, "tools/list", {}, 1)?.result as { tools: Array<{ name: string }> } | undefined;
    const resources = handle(index, "resources/list", {}, 1)?.result as { resources: unknown[] } | undefined;
    const templates = handle(index, "resources/templates/list", {}, 1)?.result as { resourceTemplates: unknown[] } | undefined;

    expect(tools?.tools.map((tool) => tool.name)).toEqual([
      "knowledge_search",
      "knowledge_read",
      "knowledge_outline",
      "knowledge_related",
      "knowledge_impact",
    ]);
    expect(resources?.resources).toHaveLength(1);
    expect(templates?.resourceTemplates).toHaveLength(2);
  });

  it("refuses a resource URI it does not serve, by name", () => {
    expect(handle(index, "resources/read", { uri: "knowledge://nowhere" }, 1)?.error?.message).toBe('no resource at "knowledge://nowhere"');
  });

  it("refuses an unknown method rather than answering it", () => {
    expect(handle(index, "tools/invoke", {}, 1)?.error?.code).toBe(-32601);
  });
});

describe("serve() — stdout purity", () => {
  it("writes nothing to stdout that is not a JSON-RPC line", async () => {
    const index = knowledge();
    const { transport, out } = pair([
      request(1, "initialize"),
      request(null, "notifications/initialized"),
      request(2, "tools/list"),
      request(3, "tools/call", { name: "knowledge_search", arguments: { query: "comment budget" } }),
      request(4, "resources/read", { uri: "knowledge://catalogue" }),
      "{not json",
      request(5, "tools/invoke"),
    ]);

    await serve(transport, index);

    expect(out.length).toBeGreaterThan(0);
    for (const line of out) {
      expect(line.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(line) as unknown).not.toThrow();
      expect((JSON.parse(line) as { jsonrpc: string }).jsonrpc).toBe("2.0");
    }
    index.close();
  });

  it("answers a notification with silence, so no unrequested line reaches the host", async () => {
    const index = knowledge();
    const { transport, out } = pair([request(null, "notifications/initialized"), request(null, "ping")]);

    await serve(transport, index);

    expect(out).toEqual([]);
    index.close();
  });

  it("survives a request that throws, and keeps answering the ones after it", async () => {
    const index = knowledge();
    const { transport, out } = pair([request(1, "tools/call", { name: "knowledge_read", arguments: { id: "nonsense" } }), request(2, "ping")]);

    await serve(transport, index);

    expect(out).toHaveLength(2);
    expect((JSON.parse(out[1] ?? "{}") as { id: number }).id).toBe(2);
    index.close();
  });
});

describe("handle() freshness", () => {
  /** The body of the one `content` entry a tool call answers with. */
  function body(response: ReturnType<typeof handle>): string {
    const result = (response as { result?: { content?: Array<{ text?: string }> } } | undefined)?.result;
    return result?.content?.[0]?.text ?? "";
  }

  it("serves a document edited after the server started, without a restart", () => {
    const { index, root } = served();
    const call = { name: "knowledge_search", arguments: { query: "honeypots" } };

    expect(body(handle(index, "tools/call", call, 1))).toContain("No section of this corpus covers");

    writeFileSync(join(root, "docs/A.md"), `${DOC}\nA sentence about honeypots.\n`, "utf-8");

    expect(body(handle(index, "tools/call", call, 2))).toContain("docs/A.md");
    index.close();
  });

  it("serves a document added after the server started, through the resource templates too", () => {
    const { index, root } = served();
    const uri = "knowledge://project/docs/B.md";

    expect(handle(index, "resources/read", { uri }, 1)).toHaveProperty("error");

    writeFileSync(join(root, "docs/B.md"), DOC.replace("The comment budget is a ceiling.", "Turnstile fails closed."), "utf-8");

    expect(JSON.stringify(handle(index, "resources/read", { uri }, 2))).toContain("Turnstile fails closed.");
    index.close();
  });

  it("does not rebuild for a method that only describes the server", () => {
    const { index, root } = served();

    writeFileSync(join(root, "docs/A.md"), `${DOC}\nA sentence about honeypots.\n`, "utf-8");
    handle(index, "tools/list", {}, 1);

    expect(search(index.db, "honeypots")).toEqual([]);
    index.close();
  });
});
