import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { v } from "../../../validation/mod";
import type { DocReads, SessionMetrics, TokenUsage, TranscriptPaths, TurnState, WardenTool } from "./types";

const SESSION_ID = /^[\w-]+$/;

const WARDEN_TOOLS: readonly WardenTool[] = ["search", "read", "outline", "related", "impact"];

const WARDEN_CLI = /\bwarden\s+(search|read|outline|related|impact)\b/;

const BASH_MD_READ = /\b(cat|sed|head|tail|less|awk)\b[^|;&]*\.md\b/;

const Count = v.optional(v.number(), 0);

const AssistantLineSchema = v.looseObject({
  type: v.literal("assistant"),
  message: v.looseObject({
    id: v.string(),
    usage: v.optional(
      v.looseObject({ input_tokens: Count, cache_creation_input_tokens: Count, cache_read_input_tokens: Count, output_tokens: Count }),
    ),
    content: v.optional(v.array(v.unknown()), []),
  }),
});

const ToolUseSchema = v.looseObject({
  type: v.literal("tool_use"),
  id: v.string(),
  name: v.string(),
  input: v.optional(v.record(v.string(), v.unknown()), {}),
});

type ToolUse = v.InferOutput<typeof ToolUseSchema>;

const ReplyLineSchema = v.looseObject({
  type: v.literal("assistant"),
  message: v.looseObject({ id: v.string(), stop_reason: v.optional(v.nullable(v.string())), content: v.optional(v.array(v.unknown()), []) }),
});

const TextBlockSchema = v.looseObject({ type: v.literal("text"), text: v.string() });

const ToolResultSchema = v.looseObject({ type: v.literal("tool_result"), tool_use_id: v.string() });

const UserLineSchema = v.looseObject({
  type: v.literal("user"),
  message: v.looseObject({ content: v.optional(v.union([v.string(), v.array(v.unknown())]), []) }),
});

const ConversationLineSchema = v.looseObject({ type: v.picklist(["user", "assistant", "system"]), subtype: v.optional(v.string()) });

/** Finds the transcript Claude Code wrote for `sessionId`, and its subagents' transcripts, under any project directory. */
export function transcriptPaths(sessionId: string, projectsDir: string = join(homedir(), ".claude", "projects")): TranscriptPaths {
  const paths = findTranscripts(sessionId, projectsDir);
  if (paths === undefined) throw new Error(`no transcript for session ${sessionId} under ${projectsDir}`);
  return paths;
}

/** As `transcriptPaths`, but undefined while the session has written no main transcript yet. */
export function findTranscripts(sessionId: string, projectsDir: string): TranscriptPaths | undefined {
  if (!SESSION_ID.test(sessionId)) throw new Error(`not a session id: ${JSON.stringify(sessionId)}`);
  const projects = existsSync(projectsDir) ? readdirSync(projectsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()) : [];
  let main: string | undefined;
  const subagents: string[] = [];
  for (const project of projects) {
    const dir = join(projectsDir, project.name);
    const candidate = join(dir, `${sessionId}.jsonl`);
    if (main === undefined && existsSync(candidate)) main = candidate;
    const subagentDir = join(dir, sessionId, "subagents");
    if (!existsSync(subagentDir)) continue;
    for (const name of readdirSync(subagentDir)) {
      if (name.startsWith("agent-") && name.endsWith(".jsonl")) subagents.push(join(subagentDir, name));
    }
  }
  return main === undefined ? undefined : { main, subagents: subagents.sort() };
}

function emptyDocReads(): DocReads {
  return {
    warden: { search: 0, read: 0, outline: 0, related: 0, impact: 0 },
    chunks: [],
    mdFileReads: 0,
    mdPaths: [],
    wardenCli: 0,
    bashMdReads: 0,
  };
}

function wardenTool(name: string): WardenTool | undefined {
  const prefix = "mcp__warden__knowledge_";
  if (!name.startsWith(prefix)) return undefined;
  const tool = name.slice(prefix.length);
  return WARDEN_TOOLS.find((known) => known === tool);
}

function classify(tool: ToolUse, reads: DocReads, chunks: Set<string>, mdPaths: Set<string>): void {
  const warden = wardenTool(tool.name);
  if (warden !== undefined) {
    reads.warden[warden] += 1;
    if (warden === "read" && typeof tool.input.id === "string") chunks.add(tool.input.id);
    return;
  }
  if (tool.name === "Read" && typeof tool.input.file_path === "string" && tool.input.file_path.endsWith(".md")) {
    reads.mdFileReads += 1;
    mdPaths.add(tool.input.file_path);
    return;
  }
  if (tool.name === "Bash" && typeof tool.input.command === "string") {
    if (WARDEN_CLI.test(tool.input.command)) reads.wardenCli += 1;
    if (BASH_MD_READ.test(tool.input.command)) reads.bashMdReads += 1;
  }
}

function jsonLines(path: string): unknown[] {
  return parseLines(path, readFileSync(path, "utf-8"));
}

function parseLines(path: string, text: string): unknown[] {
  return text.split("\n").flatMap((line, index) => {
    if (line.trim() === "") return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch (error) {
      throw new Error(`${path}:${index + 1} is not JSON`, { cause: error });
    }
  });
}

/** The metrics of a session that left no transcript: nothing spent and nothing read. */
export function emptySessionMetrics(): SessionMetrics {
  return {
    assistantMessages: 0,
    tokens: { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 },
    toolCalls: 0,
    toolsByName: {},
    docReads: emptyDocReads(),
  };
}

/** Counts the assistant messages and sums the tokens, tool calls and document reads in a session's transcripts, counting each message and each tool call once. */
export function readSessionMetrics(paths: TranscriptPaths): SessionMetrics {
  const tokens: TokenUsage = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
  const toolsByName: Record<string, number> = {};
  const docReads = emptyDocReads();
  const messages = new Set<string>();
  const assistantIds = new Set<string>();
  const toolUses = new Set<string>();
  const chunks = new Set<string>();
  const mdPaths = new Set<string>();

  for (const path of [paths.main, ...paths.subagents]) {
    for (const line of jsonLines(path)) {
      const parsed = v.safeParse(AssistantLineSchema, line);
      if (!parsed.success) continue;
      const { id, usage, content } = parsed.output.message;
      assistantIds.add(id);
      if (usage !== undefined && !messages.has(id)) {
        messages.add(id);
        tokens.input += usage.input_tokens;
        tokens.cacheCreation += usage.cache_creation_input_tokens;
        tokens.cacheRead += usage.cache_read_input_tokens;
        tokens.output += usage.output_tokens;
      }
      for (const block of content) {
        const tool = v.safeParse(ToolUseSchema, block);
        if (!tool.success || toolUses.has(tool.output.id)) continue;
        toolUses.add(tool.output.id);
        toolsByName[tool.output.name] = (toolsByName[tool.output.name] ?? 0) + 1;
        classify(tool.output, docReads, chunks, mdPaths);
      }
    }
  }

  docReads.chunks = [...chunks].sort();
  docReads.mdPaths = [...mdPaths].sort();
  return { assistantMessages: assistantIds.size, tokens, toolCalls: toolUses.size, toolsByName, docReads };
}

function contentOf(line: unknown): unknown[] {
  const reply = v.safeParse(ReplyLineSchema, line);
  if (reply.success) return reply.output.message.content;
  const user = v.safeParse(UserLineSchema, line);
  return user.success && Array.isArray(user.output.message.content) ? user.output.message.content : [];
}

function pendingToolUses(lines: readonly unknown[]): number {
  const pending = new Set<string>();
  for (const block of lines.flatMap(contentOf)) {
    const use = v.safeParse(ToolUseSchema, block);
    if (use.success) pending.add(use.output.id);
    const answer = v.safeParse(ToolResultSchema, block);
    if (answer.success) pending.delete(answer.output.tool_use_id);
  }
  return pending.size;
}

function endsTurn(line: unknown): boolean {
  const reply = v.safeParse(ReplyLineSchema, line);
  if (reply.success) return reply.output.message.stop_reason === "end_turn";
  const record = v.safeParse(ConversationLineSchema, line);
  return record.success && record.output.type === "system" && record.output.subtype === "turn_duration";
}

/** The text of the main session's last assistant message that ended its turn, joined across the lines it spans; empty when none did. */
export function lastReplyText(paths: TranscriptPaths): string {
  const lines = jsonLines(paths.main);
  const replies = lines.flatMap((line) => {
    const reply = v.safeParse(ReplyLineSchema, line);
    return reply.success ? [reply.output.message] : [];
  });
  const last = replies.findLast((message) => message.stop_reason === "end_turn")?.id;
  if (last === undefined) return "";
  return replies
    .filter((message) => message.id === last)
    .flatMap((message) =>
      message.content.flatMap((block) => {
        const text = v.safeParse(TextBlockSchema, block);
        return text.success ? [text.output.text] : [];
      }),
    )
    .join("\n");
}

/** Whether the main session's last conversation record ends a turn — its `turn_duration` or an `end_turn` reply — with no tool call unanswered, reading only complete lines. */
export function turnState(paths: TranscriptPaths): TurnState {
  const text = readFileSync(paths.main, "utf-8");
  const lines = parseLines(paths.main, text.slice(0, text.lastIndexOf("\n") + 1));
  const pendingTools = pendingToolUses(lines);
  const last = lines.findLast((line) => v.is(ConversationLineSchema, line));
  return { settled: last !== undefined && endsTurn(last) && pendingTools === 0, pendingTools };
}
