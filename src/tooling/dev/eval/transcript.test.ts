import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { lastReplyText, readSessionMetrics, transcriptPaths, turnState } from "./transcript";

const SESSION = "0b6c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function projectsDir(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-eval-transcript-"));
  roots.push(root);
  return root;
}

const usage = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 1 };

function assistant(messageId: string, block: Record<string, unknown>): string {
  return JSON.stringify({ type: "assistant", message: { id: messageId, usage, content: [block] } });
}

function toolUse(id: string, name: string, input: Record<string, unknown>): Record<string, unknown> {
  return { type: "tool_use", id, name, input };
}

function writeTranscript(dir: string, path: string, lines: string[]): string {
  const file = join(dir, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, lines.join("\n") + "\n", "utf-8");
  return file;
}

function metricsOf(lines: string[]): ReturnType<typeof readSessionMetrics> {
  const dir = projectsDir();
  return readSessionMetrics({ main: writeTranscript(dir, `p/${SESSION}.jsonl`, lines), subagents: [] });
}

describe("transcriptPaths()", () => {
  it("finds the main transcript and every subagent transcript beside it", () => {
    const dir = projectsDir();
    const main = writeTranscript(dir, `-home-x/${SESSION}.jsonl`, []);
    const b = writeTranscript(dir, `-home-x/${SESSION}/subagents/agent-b.jsonl`, []);
    const a = writeTranscript(dir, `-home-x/${SESSION}/subagents/agent-a.jsonl`, []);
    writeTranscript(dir, `-home-x/${SESSION}/subagents/notes.txt`, []);
    expect(transcriptPaths(SESSION, dir)).toEqual({ main, subagents: [a, b] });
  });

  it("throws when the main transcript is missing, rather than reporting a session that spent nothing", () => {
    const dir = projectsDir();
    writeTranscript(dir, `-home-x/${SESSION}/subagents/agent-a.jsonl`, []);
    expect(() => transcriptPaths(SESSION, dir)).toThrow(/no transcript for session/);
  });

  it("throws when the projects directory itself is missing", () => {
    expect(() => transcriptPaths(SESSION, join(projectsDir(), "absent"))).toThrow(/no transcript for session/);
  });

  it("refuses an id that would reach outside the projects directory", () => {
    expect(() => transcriptPaths("../etc", projectsDir())).toThrow(/not a session id/);
  });
});

describe("readSessionMetrics()", () => {
  it("sums usage once per message id, though every content block of the message repeats it", () => {
    const metrics = metricsOf([
      assistant("msg_1", { type: "thinking", thinking: "" }),
      assistant("msg_1", { type: "text", text: "reading" }),
      assistant("msg_1", toolUse("tu_1", "Grep", {})),
      assistant("msg_2", { type: "text", text: "done" }),
    ]);
    expect(metrics.tokens).toEqual({ input: 20, cacheCreation: 200, cacheRead: 2000, output: 2 });
  });

  it("counts a tool call once per tool_use id", () => {
    const metrics = metricsOf([
      assistant("msg_1", toolUse("tu_1", "Grep", {})),
      assistant("msg_1", toolUse("tu_1", "Grep", {})),
      assistant("msg_2", toolUse("tu_2", "Grep", {})),
      assistant("msg_2", toolUse("tu_3", "Edit", {})),
    ]);
    expect(metrics.toolCalls).toBe(3);
    expect(metrics.toolsByName).toEqual({ Grep: 2, Edit: 1 });
  });

  it("includes each subagent's tokens and tool calls", () => {
    const dir = projectsDir();
    const main = writeTranscript(dir, `p/${SESSION}.jsonl`, [assistant("msg_1", toolUse("tu_1", "Agent", {}))]);
    const subagent = writeTranscript(dir, `p/${SESSION}/subagents/agent-a.jsonl`, [assistant("msg_2", toolUse("tu_2", "Read", {}))]);
    const metrics = readSessionMetrics({ main, subagents: [subagent] });
    expect(metrics.tokens.input).toBe(20);
    expect(metrics.toolsByName).toEqual({ Agent: 1, Read: 1 });
  });

  it("ignores lines that are not assistant messages", () => {
    const metrics = metricsOf([
      JSON.stringify({ type: "user", message: { id: "msg_u", usage, content: [toolUse("tu_u", "Grep", {})] } }),
      JSON.stringify({ type: "summary" }),
      "",
    ]);
    expect(metrics.toolCalls).toBe(0);
    expect(metrics.tokens.input).toBe(0);
    expect(metrics.assistantMessages).toBe(0);
  });

  it("counts each assistant message once, across the main and subagent transcripts", () => {
    const dir = projectsDir();
    const main = writeTranscript(dir, `p/${SESSION}.jsonl`, [
      assistant("msg_1", { type: "text", text: "a" }),
      assistant("msg_1", toolUse("tu_1", "Agent", {})),
      assistant("msg_2", { type: "text", text: "b" }),
    ]);
    const subagent = writeTranscript(dir, `p/${SESSION}/subagents/agent-a.jsonl`, [assistant("msg_3", { type: "text", text: "c" })]);
    expect(readSessionMetrics({ main, subagents: [subagent] }).assistantMessages).toBe(3);
  });

  it("names the file and line of a line that is not JSON", () => {
    expect(() => metricsOf([assistant("msg_1", { type: "text" }), "{not json"])).toThrow(/jsonl:2 is not JSON/);
  });

  it("counts each warden tool by name and collects the chunk ids knowledge_read was given", () => {
    const metrics = metricsOf([
      assistant("m1", toolUse("t1", "mcp__warden__knowledge_search", { query: "q" })),
      assistant("m2", toolUse("t2", "mcp__warden__knowledge_read", { id: "canon:CODE_RULES.md#5a" })),
      assistant("m3", toolUse("t3", "mcp__warden__knowledge_read", { id: "canon:CODE_RULES.md#5a" })),
      assistant("m4", toolUse("t4", "mcp__warden__knowledge_read", { id: "project:docs/NAMESPACES.md#5g" })),
      assistant("m5", toolUse("t5", "mcp__warden__knowledge_outline", { path: "docs/X.md" })),
      assistant("m6", toolUse("t6", "mcp__warden__knowledge_related", { id: "x" })),
      assistant("m7", toolUse("t7", "mcp__warden__knowledge_impact", { ref: "HEAD" })),
      assistant("m8", toolUse("t8", "mcp__ledger__get_task", {})),
    ]);
    expect(metrics.docReads.warden).toEqual({ search: 1, read: 3, outline: 1, related: 1, impact: 1 });
    expect(metrics.docReads.chunks).toEqual(["canon:CODE_RULES.md#5a", "project:docs/NAMESPACES.md#5g"]);
  });

  it("counts a Read of a markdown file and collects its path, and leaves any other Read out", () => {
    const metrics = metricsOf([
      assistant("m1", toolUse("t1", "Read", { file_path: "/r/docs/NAMESPACES.md" })),
      assistant("m2", toolUse("t2", "Read", { file_path: "/r/docs/NAMESPACES.md" })),
      assistant("m3", toolUse("t3", "Read", { file_path: "/r/src/app/mod.ts" })),
    ]);
    expect(metrics.docReads.mdFileReads).toBe(2);
    expect(metrics.docReads.mdPaths).toEqual(["/r/docs/NAMESPACES.md"]);
  });

  it("counts the warden CLI and a shell read of a markdown file separately", () => {
    const metrics = metricsOf([
      assistant("m1", toolUse("t1", "Bash", { command: 'warden search "barrel rules"' })),
      assistant("m2", toolUse("t2", "Bash", { command: "bun warden read canon:CODE_RULES.md#5a" })),
      assistant("m3", toolUse("t3", "Bash", { command: "sed -n 1,40p docs/FORGE_STRUCTURE.md" })),
      assistant("m4", toolUse("t4", "Bash", { command: "ls docs | grep README.md" })),
      assistant("m5", toolUse("t5", "Bash", { command: "warden sync --check" })),
    ]);
    expect(metrics.docReads.wardenCli).toBe(2);
    expect(metrics.docReads.bashMdReads).toBe(1);
    expect(metrics.docReads.mdFileReads).toBe(0);
  });
});

function record(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

function reply(messageId: string, stopReason: string | null, block: Record<string, unknown>): string {
  return record({ type: "assistant", message: { id: messageId, stop_reason: stopReason, usage, content: [block] } });
}

function mainOf(lines: string[], trailingNewline = true): { main: string; subagents: string[] } {
  const dir = projectsDir();
  const main = writeTranscript(dir, `p/${SESSION}.jsonl`, lines);
  if (!trailingNewline) writeFileSync(main, lines.join("\n"), "utf-8");
  return { main, subagents: [] };
}

const PROMPT = record({ type: "user", message: { role: "user", content: "do it" } });
const TURN_DURATION = record({ type: "system", subtype: "turn_duration", durationMs: 76292, messageCount: 48 });

describe("lastReplyText()", () => {
  it("joins the text of every line the last end_turn message spans, and skips its thinking", () => {
    const paths = mainOf([
      PROMPT,
      reply("msg_1", "end_turn", { type: "text", text: "an earlier answer" }),
      PROMPT,
      reply("msg_2", "end_turn", { type: "thinking", thinking: "hmm" }),
      reply("msg_2", "end_turn", { type: "text", text: "first part" }),
      reply("msg_2", "end_turn", { type: "text", text: "```json\n[]\n```" }),
      TURN_DURATION,
      record({ type: "last-prompt", lastPrompt: "do it" }),
    ]);
    expect(lastReplyText(paths)).toBe("first part\n```json\n[]\n```");
  });

  it("passes over a later message that did not end its turn", () => {
    const paths = mainOf([
      reply("msg_1", "end_turn", { type: "text", text: "the answer" }),
      reply("msg_2", "tool_use", toolUse("tu_1", "Read", {})),
    ]);
    expect(lastReplyText(paths)).toBe("the answer");
  });

  it("reads the main transcript alone, so a subagent's reply is never taken for the session's", () => {
    const dir = projectsDir();
    const main = writeTranscript(dir, `p/${SESSION}.jsonl`, [reply("msg_1", "end_turn", { type: "text", text: "main" })]);
    const subagent = writeTranscript(dir, `p/${SESSION}/subagents/agent-a.jsonl`, [reply("msg_2", "end_turn", { type: "text", text: "sub" })]);
    expect(lastReplyText({ main, subagents: [subagent] })).toBe("main");
  });

  it("is empty when no message ended its turn", () => {
    expect(lastReplyText(mainOf([PROMPT, reply("msg_1", "tool_use", toolUse("tu_1", "Read", {}))]))).toBe("");
  });
});

describe("turnState()", () => {
  it("is settled when the last conversation record is turn_duration, though bookkeeping records follow it", () => {
    const state = turnState(
      mainOf([
        PROMPT,
        reply("msg_1", "end_turn", { type: "text", text: "done" }),
        TURN_DURATION,
        record({ type: "last-prompt" }),
        record({ type: "cost-state" }),
      ]),
    );
    expect(state).toEqual({ settled: true, pendingTools: 0 });
  });

  it("falls back to an end_turn reply with no tool call pending when no turn_duration was written", () => {
    expect(turnState(mainOf([PROMPT, reply("msg_1", "end_turn", { type: "text", text: "done" })])).settled).toBe(true);
  });

  it("is not settled while a tool call has no result, and counts it", () => {
    const pending = mainOf([
      PROMPT,
      reply("msg_1", "tool_use", toolUse("tu_1", "Bash", {})),
      reply("msg_1", "tool_use", toolUse("tu_2", "Read", {})),
    ]);
    expect(turnState(pending)).toEqual({ settled: false, pendingTools: 2 });
    const answered = mainOf([
      PROMPT,
      reply("msg_1", "tool_use", toolUse("tu_1", "Bash", {})),
      record({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok" }] } }),
      reply("msg_2", "end_turn", { type: "text", text: "done" }),
      TURN_DURATION,
    ]);
    expect(turnState(answered)).toEqual({ settled: true, pendingTools: 0 });
  });

  it("is not settled by a turn_duration while a tool call is still unanswered", () => {
    expect(turnState(mainOf([PROMPT, reply("msg_1", "tool_use", toolUse("tu_1", "Agent", {})), TURN_DURATION]))).toEqual({
      settled: false,
      pendingTools: 1,
    });
  });

  it("is not settled when the last conversation record is the user's prompt, or a reply cut off mid-turn", () => {
    expect(turnState(mainOf([reply("msg_1", "end_turn", { type: "text", text: "a" }), PROMPT])).settled).toBe(false);
    expect(turnState(mainOf([PROMPT, reply("msg_1", null, { type: "text", text: "partial" })])).settled).toBe(false);
  });

  it("reads only complete lines, so a line still being written neither throws nor counts", () => {
    const paths = mainOf([PROMPT, reply("msg_1", "end_turn", { type: "text", text: "done" }), '{"type":"user","mess'], false);
    expect(turnState(paths)).toEqual({ settled: true, pendingTools: 0 });
  });
});
