import { defineRules } from "../../define";

export default defineRules([
  {
    id: "agent-guide-no-tally",
    statement: "A governing document records that a thing exists, never how many of it exist.",
    detectors: [{ kind: "step", label: "validate-docs" }],
  },
  {
    id: "agent-guide-governance-links-one-way",
    statement: "Implementation may cite governance, but a governance document never links into a repository's own files.",
    detectors: [{ kind: "rg", pattern: String.raw`(?:\]\(|\]:\s*)(?:\.\./){2}`, paths: ["warden/canon/"], include: ["*.md"], level: "fail" }],
  },
  {
    id: "agent-guide-unique-filename",
    statement: "Two governing documents reachable from one repository never share a filename, a canon `libs` and `apps` pair aside.",
    detectors: [{ kind: "step", label: "warden:index" }],
  },
  {
    id: "agent-guide-agents-reconciled",
    statement: "Every agent `CLAUDE.md` names has a definition under `.claude/agents/`, and every defined agent is named in `CLAUDE.md`.",
    detectors: [{ kind: "step", label: "warden" }],
  },
  {
    id: "agent-guide-rule-in-register",
    statement: "A rule with an id has its sentence only in the rule register, and the prose its marker opens never restates it.",
    detectors: [{ kind: "step", label: "validate-rules" }],
  },
]);
