import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { checkResult, fail } from "../finding";
import type { CheckResult } from "../types";
import { deriveDesignScale, renderDesignScale } from "./design-scale-parse";
import { canonical, fileURLToPathish, loadDesignSystem } from "./design-system";
import type { DesignScale } from "./types";
import type { DesignScaleCheckConfig } from "./types";

/** Compiles the stylesheet and derives the scale it implies. @public */
export async function deriveScale(config: DesignScaleCheckConfig): Promise<DesignScale> {
  return deriveDesignScale(await loadDesignSystem(resolve(config.root, config.stylesheet)));
}

/** Regenerates the scale from the stylesheet and reports any drift from the committed module. @public */
export async function checkDesignScale(config: DesignScaleCheckConfig): Promise<CheckResult> {
  const expected = renderDesignScale(await deriveScale(config));
  const path = resolve(config.root, config.table);

  let actual: string;
  try {
    actual = readFileSync(path, "utf-8");
  } catch {
    return checkResult([fail("the generated design scale is missing", { file: config.table, detail: ["run `bun run gen:design-scale`"] })], "");
  }

  if (canonical(actual) === canonical(expected)) {
    return checkResult([], `${config.table} matches the scale \`${config.stylesheet}\` compiles to`);
  }

  return checkResult(
    [
      fail("the committed design scale no longer matches the design system", {
        file: config.table,
        detail: [
          `\`${config.stylesheet}\` now compiles to a different scale — a \`tailwindcss\` release, a theme edit, or a hand edit to the generated file`,
          "run `bun run gen:design-scale` and review the diff before committing it",
        ],
      }),
    ],
    "",
  );
}

/** Writes the derived scale over the committed module. The caller formats it — `gen:design-scale`
 *  runs `oxfmt` over the written file, which is why the drift check compares content, not layout. @public */
export async function writeDesignScale(config: DesignScaleCheckConfig): Promise<void> {
  writeFileSync(resolve(config.root, config.table), renderDesignScale(await deriveScale(config)), "utf-8");
}

if (import.meta.main) {
  const root = resolve(dirname(fileURLToPathish(import.meta.url)), "../../../..");
  await writeDesignScale({ root, stylesheet: "src/ui/assets/css/tailwind.css", table: "src/tooling/lint/data/design-scale.ts" });
  console.log("wrote src/tooling/lint/data/design-scale.ts");
}
