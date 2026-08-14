import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { type CheckResult, checkResult, type Finding, fail } from "../finding";
import { findSlotClobbers } from "./jsx-parse";

/** What the JSX check needs to know about the project. @public */
export interface JsxCheckConfig {
  /** Repository root; every reported path is relative to it. */
  root: string;
  /** Directories walked for `.tsx` files, relative to `root`. Defaults to `["src"]`. */
  sources?: readonly string[];
  /** Pragma lines every shipped `.tsx` file must contain, matched as substrings; defaults to forge's own pair. */
  pragmas?: readonly string[];
}

const DEFAULT_PRAGMAS = ["@jsxRuntime automatic", "@jsxImportSource @y-core/forge/jsx"] as const;

function collectTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsx(full));
    } else if (entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

/** The `.tsx` files the check will judge, as absolute paths. @public */
export function resolveJsxSources(config: JsxCheckConfig): string[] {
  const sources = config.sources ?? ["src"];
  return sources.flatMap((dir) => collectTsx(resolve(config.root, dir)));
}

/** Judges one file's source against both the pragma and `data-slot` rules. @public */
export function validateJsxSource(file: string, source: string, pragmas: readonly string[] = DEFAULT_PRAGMAS): Finding[] {
  const missing = pragmas.filter((pragma) => !source.includes(pragma));
  const clobbers = findSlotClobbers(source);
  if (missing.length === 0 && clobbers.length === 0) return [];

  const detail = [
    ...missing.map((pragma) => `missing: /** ${pragma} */`),
    ...clobbers.map(
      ({ line, tag, slot, spread }) =>
        `line ${line}: \`<${tag}>\` has a literal \`data-slot='${slot}'\` before \`{...${spread}}\` — the spread wins and the token is lost; destructure \`"data-slot": inherited\` and write \`data-slot={slotToken("${slot}", inherited)}\``,
    ),
  ];

  return [fail("JSX contract violated", { file, detail })];
}

/** Walk the configured sources and judge every `.tsx` file in them. @public */
export function checkJsx(config: JsxCheckConfig): CheckResult {
  const pragmas = config.pragmas ?? DEFAULT_PRAGMAS;
  const files = resolveJsxSources(config);

  const findings = files.flatMap((file) => validateJsxSource(relative(config.root, file), readFileSync(file, "utf-8"), pragmas));

  if (findings.length > 0) {
    findings.push(
      fail(
        "Each shipped .tsx file must carry every JSX pragma line, and must merge every `data-slot` it writes rather than leaving it exposed to a later spread.",
      ),
    );
  }

  return checkResult(findings, `${files.length} .tsx files carry every JSX pragma and no clobberable \`data-slot\`.`);
}
