import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { type CheckResult, checkResult, fail } from "../finding";
import { type ClassGroupTable, deriveClassGroups, renderClassGroups } from "./class-groups-parse";
import { canonical, fileURLToPathish, loadDesignSystem } from "./design-system";

// One definition, because `gen:class-groups` and `validate-class-groups` derive the same table: a
// list that differed between them would write a file the drift check then rejects.
/** The `forge-ui.css` `@utility` recipes that paint nothing in the base state. @public */
export const FORGE_STATE_RECIPES: readonly string[] = ["focus-ring", "focus-ring-outset", "state-busy", "state-disabled", "state-invalid"];

/** What the class-groups check needs to know about the project. @public */
export interface ClassGroupsCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** The stylesheet the design system is compiled from, relative to `root`. */
  stylesheet: string;
  /** The generated module the derived table is committed to, relative to `root`. */
  table: string;
  /** `@utility` recipes whose payload is conditional, keyed into a slot no Tailwind utility reaches. */
  stateRecipes?: readonly string[];
}

/** Compiles the stylesheet and derives the conflict table it implies. @public */
export async function deriveTable(config: ClassGroupsCheckConfig): Promise<ClassGroupTable> {
  return deriveClassGroups(await loadDesignSystem(resolve(config.root, config.stylesheet)), config.stateRecipes);
}

/** Regenerates the table from the stylesheet and reports any drift from the committed module. @public */
export async function checkClassGroups(config: ClassGroupsCheckConfig): Promise<CheckResult> {
  const expected = renderClassGroups(await deriveTable(config));
  const path = resolve(config.root, config.table);

  let actual: string;
  try {
    actual = readFileSync(path, "utf-8");
  } catch {
    return checkResult([fail("the generated conflict table is missing", { file: config.table, detail: ["run `bun run gen:class-groups`"] })], "");
  }

  if (canonical(actual) === canonical(expected)) {
    return checkResult([], `${config.table} matches the table \`${config.stylesheet}\` compiles to`);
  }

  return checkResult(
    [
      fail("the committed conflict table no longer matches the design system", {
        file: config.table,
        detail: [
          `\`${config.stylesheet}\` now compiles to a different table — a \`tailwindcss\` release, a theme edit, or a hand edit to the generated file`,
          "run `bun run gen:class-groups` and review the diff before committing it",
        ],
      }),
    ],
    "",
  );
}

/** Writes the derived table over the committed module. The caller formats it — `gen:class-groups`
 *  runs `oxfmt` over the written file, which is why the drift check compares content, not layout. @public */
export async function writeClassGroups(config: ClassGroupsCheckConfig): Promise<void> {
  writeFileSync(resolve(config.root, config.table), renderClassGroups(await deriveTable(config)), "utf-8");
}

if (import.meta.main) {
  const root = resolve(dirname(fileURLToPathish(import.meta.url)), "../../../../..");
  await writeClassGroups({
    root,
    stylesheet: "src/ui/assets/css/tailwind.css",
    table: "src/ui/core/utils/class-groups.ts",
    stateRecipes: FORGE_STATE_RECIPES,
  });
  console.log("wrote src/ui/core/utils/class-groups.ts");
}
