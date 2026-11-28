import { v } from "../../../validation/mod";
import type { EvalTrap, ParsedReview, ReviewFinding, TrapFiring, TrapVerdict } from "./types";

const JSON_FENCE = /```json[^\n]*\n([\s\S]*?)```/g;

const WHERE = /([^\s:`'"(]+):(\d+)/;

const PROXIMITY = 3;

const Text = v.string();

const FindingsSchema = v.array(
  v.object({
    impact: Text,
    where: Text,
    what: Text,
    exploitScenario: Text,
    preconditions: v.union([Text, v.array(Text)]),
    fix: Text,
    chunkIds: v.array(Text),
  }),
);

/** Appended to every reviewer prompt, so the findings come back in a shape `parseFindings` can read. */
export const REVIEW_SUFFIX = [
  "",
  "When the review is done, end your reply with one fenced ```json block holding a JSON array, one object per finding, and nothing after it.",
  'Each object has the six CODE_REVIEW.md §1b fields as strings — "impact", "where", "what", "exploitScenario", "preconditions", "fix" — and',
  '"chunkIds", an array of the chunk ids (such as "canon:CODE_RULES.md#5a") of every rule the finding rests on.',
  'Write "where" as path/file.ts:123, relative to the repository root. With no findings, the block holds [].',
].join("\n");

/** Reads the findings from the last ```json fence of a reviewer's reply; a missing or malformed fence yields none and sets `reviewParseFailed`. */
export function parseFindings(text: string): ParsedReview {
  const fence = [...text.matchAll(JSON_FENCE)].at(-1)?.[1];
  if (fence === undefined) return { findings: [], reviewParseFailed: true };
  let json: unknown;
  try {
    json = JSON.parse(fence);
  } catch {
    return { findings: [], reviewParseFailed: true };
  }
  const parsed = v.safeParse(FindingsSchema, json);
  if (!parsed.success) return { findings: [], reviewParseFailed: true };
  const findings: ReviewFinding[] = parsed.output;
  return { findings, reviewParseFailed: false };
}

function location(where: string): { file: string; line: number } | undefined {
  const match = WHERE.exec(where);
  if (match === null) return undefined;
  return { file: (match[1] ?? "").replace(/^\.\//, ""), line: Number(match[2]) };
}

function sameFile(cited: string, hit: string): boolean {
  return cited === hit || cited.endsWith(`/${hit}`);
}

function matches(finding: ReviewFinding, trap: EvalTrap, firing: TrapFiring): boolean {
  if (finding.chunkIds.some((id) => trap.rules.includes(id))) return true;
  const cited = location(finding.where);
  if (cited === undefined) return false;
  return firing.hits.some((hit) => sameFile(cited.file, hit.file) && Math.abs(cited.line - hit.line) <= PROXIMITY);
}

/** Judges each trap against the reviewer's findings: `caught` when a finding cites one of its rules or lands near a line its detector hit. */
export function matchFindings(
  findings: readonly ReviewFinding[],
  traps: readonly EvalTrap[],
  firing: Readonly<Record<string, TrapFiring>>,
): Record<string, TrapVerdict> {
  const verdicts: Record<string, TrapVerdict> = {};
  for (const trap of traps) {
    const fired = firing[trap.id];
    if (fired === undefined || !fired.fires) verdicts[trap.id] = "clean";
    else verdicts[trap.id] = findings.some((finding) => matches(finding, trap, fired)) ? "caught" : "through";
  }
  return verdicts;
}
