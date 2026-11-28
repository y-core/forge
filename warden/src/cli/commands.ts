import { addCommand, createCommand } from "../../../src/tooling/cli/command";
import { CliError } from "../../../src/tooling/cli/errors";
import type { CommandBase } from "../../../src/tooling/cli/types";
import { CLAUDE_ROOT, resolveRepoRoot } from "../paths";
import { check } from "../sync/check";
import { resolveKindSource } from "../sync/kind";
import { seed, seedFiles } from "../sync/seed";
import { sync, syncPlan } from "../sync/sync";
import { createCheckCommand } from "./check";
import { ROOT_FLAG } from "./flags";
import { createCatalogueCommand, createKnowledgeCommands, createServeCommand } from "./knowledge";
import { DEFAULT_ARCH, placeNatives } from "./natives";
import { createRulesCommand } from "./rules";
import { show, SUBJECTS, type Subject } from "./show";

/** Builds the `warden` command tree. @public */
export function createWardenCommands(): CommandBase {
  const root = createCommand({ name: "warden", description: "The fleet corpus and the machinery that keeps a repository in step with it" });

  addCommand(
    root,
    createCommand({
      name: "sync",
      description: "Replace .claude/agents, .claude/skills, .claude/settings.json and .codex/config.toml.example from the installed corpus",
      flags: {
        check: { type: "boolean", description: "Report drift and exit 1 if any, writing nothing" },
        init: { type: "boolean", description: "Also seed CLAUDE.md and AGENTS.md if absent" },
        kind: { type: "string", description: "Select the tree (libs|apps), overriding package.json's `warden.kind`" },
        root: ROOT_FLAG,
      },
      run: (_args, flags) => {
        const repo = resolveRepoRoot(flags.root);
        const { kind, source } = resolveKindSource(repo, flags.kind);
        const plan = syncPlan(CLAUDE_ROOT, kind, repo);
        // A sync replaces `.claude/agents/` wholesale, so a libs repository that dropped its
        // declaration would silently be given the apps definitions; naming the default shows it.
        if (source === "default") {
          console.log('note      no `warden.kind` in package.json — defaulting to apps; declare `"warden": { "kind": "libs" }` for a library');
        }

        if (flags.check) {
          const problems = check(repo, plan);
          if (problems.length === 0) {
            console.log(`✓ warden in sync — ${kind}`);
            return;
          }
          console.error(`✗ warden drift — ${kind}, ${problems.length} problem(s):`);
          for (const { code, detail } of problems) console.error(`  ${code.padEnd(9)} ${detail}`);
          console.error("\nThe synced trees and files are overwrite-on-sync: for a missing, modified or extra file run");
          console.error("`warden sync`, keep a repository-local rule in that repository's own docs/, and a");
          console.error("repository-local setting in the untracked .claude/settings.local.json. The rest are this");
          console.error("repository's own to fix — its .gitignore, its index, and the agents CLAUDE.md names.");
          throw new CliError("invalid-args", "warden drift");
        }

        for (const path of sync(repo, plan)) console.log(`synced    ${path}`);
        if (flags.init)
          for (const { file, outcome } of seed(repo, seedFiles(CLAUDE_ROOT, kind), plan.slug)) console.log(`${outcome.padEnd(9)} ${file}`);
        console.log(`✓ warden synced — ${kind}`);
      },
    }),
  );

  addCommand(
    root,
    createCommand({
      name: "natives",
      description: "Place the editor architecture's prebuilt native bindings into node_modules",
      flags: { arch: { type: "string", description: `Platform-arch to fetch (default: ${DEFAULT_ARCH})` }, root: ROOT_FLAG },
      run: async (_args, flags) => {
        await placeNatives(resolveRepoRoot(flags.root), flags.arch ?? DEFAULT_ARCH);
      },
    }),
  );

  addCommand(
    root,
    createCommand({
      name: "show",
      description: "Write one shipped example configuration to stdout, to merge by hand",
      flags: { zed: { type: "boolean", description: SUBJECTS.zed.summary } },
      run: (_args, flags) => {
        const named = (Object.keys(SUBJECTS) as Subject[]).filter((name) => flags[name] === true);
        const only = named[0];
        if (named.length !== 1 || only === undefined) {
          throw new CliError("invalid-args", `name exactly one subject — ${(Object.keys(SUBJECTS) as Subject[]).map((n) => `--${n}`).join(", ")}`);
        }
        show(only);
      },
    }),
  );

  addCommand(root, createRulesCommand());
  addCommand(root, createCheckCommand());
  createKnowledgeCommands(root);
  createCatalogueCommand(root);
  createServeCommand(root);

  return root;
}
