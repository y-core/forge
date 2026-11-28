import type { Database } from "bun:sqlite";

import { err, ok } from "../../../src/result/result";
import type { Result } from "../../../src/result/types";
import { loadConfigModule } from "../../../src/tooling/cli/config-module";
import { declaredSteps, isStepsConfig } from "../../../src/tooling/gate/tiers";
import { GATE_TIERS, type GateTier } from "../../../src/tooling/gate/types";
import { loadRegister, registerTrees } from "../rules/load";
import type { RegisteredRule } from "../rules/types";
import type { Kind } from "../types";

/** One indexed section, with the edges it carries, as a Code Mode query sees it. @public */
export interface CorpusSection {
  /** The `knowledge_read` id, e.g. `canon:CODE_RULES.md#5c`. */
  readonly id: string;
  readonly corpus: string;
  readonly path: string;
  readonly section: string;
  readonly title: string;
  readonly gloss: string;
  readonly body: string;
  readonly relations: readonly { readonly kind: string; readonly to: string | null }[];
}

/** One row of the repository's step table, as a Code Mode query sees it. @public */
export interface StepSummary {
  readonly tier: GateTier;
  readonly label: string;
  readonly fixable: boolean;
  readonly watches?: readonly string[];
}

/** The rules in scope for a repository of `kind`, joined to their markers. @public */
export function rulesInScope(root: string, kind: Kind): Result<RegisteredRule[], string> {
  const register = loadRegister({ root, kind, trees: registerTrees(root, kind) });
  return register.ok ? ok(register.data.filter((rule) => rule.scope.includes(kind))) : register;
}

/** Every section an open index holds, each with its outbound relations. @public */
export function corpusSections(db: Database): CorpusSection[] {
  type Row = { id: string; corpus: string; path: string; section: string; title: string; gloss: string; body: string };
  const rows = db
    .query<Row, []>(
      "SELECT chunk.id, source.corpus, source.path, chunk.section, chunk.title, chunk.gloss, chunk.body FROM chunk JOIN source ON source.id = chunk.source_id ORDER BY source.corpus, source.path, chunk.ordinal",
    )
    .all();
  const edges = new Map<string, { kind: string; to: string | null }[]>();
  for (const edge of db.query<{ from_id: string; kind: string; to_id: string | null }, []>("SELECT from_id, kind, to_id FROM relation").all()) {
    edges.set(edge.from_id, [...(edges.get(edge.from_id) ?? []), { kind: edge.kind, to: edge.to_id }]);
  }
  return rows.map((row) => ({ ...row, relations: edges.get(row.id) ?? [] }));
}

/** The rows the repository's step table declares, tier by tier, or why it could not be read. @public */
export async function loadSteps(root: string, path = "config/steps.config.ts"): Promise<Result<StepSummary[], string>> {
  let loaded: Awaited<ReturnType<typeof loadConfigModule<unknown>>>;
  try {
    loaded = await loadConfigModule<unknown>({ root, path, explicit: false, what: "step table" });
  } catch (error) {
    return err(`${path} could not be loaded — ${error instanceof Error ? error.message : String(error)}`);
  }
  if (loaded === undefined) return ok([]);
  if (!isStepsConfig(loaded.value)) return err(`${path} does not default-export defineSteps({ tiers: { … } })`);
  const { tiers } = loaded.value;
  return ok(
    GATE_TIERS.flatMap((tier) =>
      declaredSteps({ [tier]: tiers[tier] ?? [] }).map((step) => ({
        tier,
        label: step.label,
        fixable: step.fix !== undefined,
        ...(step.watches === undefined ? {} : { watches: step.watches }),
      })),
    ),
  );
}
