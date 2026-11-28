import { createCommand } from "../../../src/tooling/cli/command";
import { CliError } from "../../../src/tooling/cli/errors";
import type { CommandBase } from "../../../src/tooling/cli/types";
import { resolveRepoRoot } from "../paths";
import { type CheckReport, rgArgv, sweepRules } from "../rules/check";
import { loadRegister, registerTrees } from "../rules/load";
import type { RegisteredRule, RgDetector } from "../rules/types";
import { resolveKind } from "../sync/kind";
import { KIND_FLAG, ROOT_FLAG } from "./flags";

function list(value: string | undefined): string[] | undefined {
  return value === undefined
    ? undefined
    : value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "");
}

function quote(arg: string): string {
  return /^[\w./=-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
}

function rendered(report: CheckReport, rules: readonly RegisteredRule[]): string[] {
  const lines: string[] = [];
  for (const rule of report.rules) {
    const hits = report.findings.filter((finding) => finding.rule === rule.id);
    const level = hits[0]?.level ?? "warn";
    lines.push(`[${rule.id}] ${level} — ${rule.statement}`, `  rationale: ${rule.rationale}`);
    if (rule.triage !== undefined) lines.push(`  triage: ${rule.triage}`);
    const detector = rules.find(({ id }) => id === rule.id)?.detectors.find((d): d is RgDetector => d.kind === "rg");
    if (detector !== undefined) lines.push(`  rg: ${rgArgv(detector).map(quote).join(" ")}`);
    for (const hit of hits) lines.push(`  ${hit.file}:${hit.line}: ${hit.match}`);
  }
  const failing = report.findings.filter((finding) => finding.level === "fail").length;
  lines.push(`${report.findings.length} hit(s), ${failing} fail-level, across ${report.rules.length} rule(s) over ${report.scanned} file(s)`);
  return lines;
}

/** Builds `warden check`: the register's line patterns over the tree, a file list or a diff, each hit with its rule's statement and triage. @public */
export function createCheckCommand(): CommandBase {
  return createCommand({
    name: "check",
    description: "Match the register's rg patterns over the tree, --files or --diff, printing each hit with its rule, rationale and triage",
    flags: {
      root: ROOT_FLAG,
      kind: KIND_FLAG,
      files: { type: "string", description: "Comma-separated repository-relative files to check instead of the tree" },
      diff: { type: "string", description: "Check only files changed against this git ref, untracked ones included" },
      rules: { type: "string", description: "Comma-separated rule ids to run instead of every rule in scope" },
      json: { type: "boolean", description: "Print { findings, rules, scanned } as JSON" },
    },
    run: (_args, flags) => {
      if (flags.files !== undefined && flags.diff !== undefined) throw new CliError("invalid-args", "name --files or --diff, not both");
      const root = resolveRepoRoot(flags.root);
      const kind = resolveKind(root, flags.kind);
      const register = loadRegister({ root, kind, trees: registerTrees(root, kind) });
      if (!register.ok) throw new CliError("invalid-args", register.error);
      const ids = list(flags.rules);
      const rules = ids === undefined ? register.data.filter((rule) => rule.scope.includes(kind)) : register.data;
      const files = list(flags.files);
      const report = sweepRules({
        root,
        rules,
        ...(files === undefined ? {} : { files }),
        ...(flags.diff === undefined ? {} : { diff: flags.diff }),
        ...(ids === undefined ? {} : { ids }),
      });
      if (!report.ok) throw new CliError("invalid-args", report.error);
      console.log(flags.json ? JSON.stringify(report.data, null, 2) : rendered(report.data, rules).join("\n"));
      const failing = report.data.findings.filter((finding) => finding.level === "fail").length;
      if (failing > 0) throw new CliError("external", `${failing} fail-level hit(s) — each is a rule the gate holds`);
    },
  });
}
