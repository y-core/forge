import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { collectFiles, isTestSource } from "./source-scan";
import type { MenuNamingCheckConfig } from "./types";

const SCANNED = (name: string): boolean => (name.endsWith(".ts") || name.endsWith(".tsx")) && !isTestSource(name);

// Stopping at `children` is what keeps a nested popup's id from being read as its parent's, and the
// window bounds a file whose element never closes inside it.
/** The props text of the component occurrence starting at `from`: up to `children` or the tag's end. */
function propsOf(source: string, from: number): string {
  const window = source.slice(from, from + 400);
  const end = window.search(/\bchildren\b|>/);
  return end === -1 ? window : window.slice(0, end);
}

/** The literal value of `name` in a props region, in either the JSX or the call spelling, or `null`. */
function literalProp(props: string, name: string): string | null {
  return new RegExp(`\\b${name}[=:]\\s*\\{?\\s*['"]([\\w-]+)['"]`).exec(props)?.[1] ?? null;
}

// The lookbehind keeps a closing JSX tag out: `</Menu.Trigger>` has no props, and reading its empty
// region as an unreadable target would leave every file using JSX unjudged.
/** Every element named `component` in `source`, as its own props region. */
function occurrences(source: string, component: RegExp): string[] {
  return [...source.matchAll(component)].map((match) => propsOf(source, (match.index ?? 0) + match[0].length));
}

/** Every popup id a `triggered` `Menu.Popup` in `source` claims a trigger for, literal ids only. @public */
export function triggeredPopupIds(source: string): string[] {
  return occurrences(source, /(?<!\/)Menu\.Popup\b/g)
    .filter((props) => /\btriggered\b/.test(props))
    .map((props) => literalProp(props, "id"))
    .filter((id): id is string => id !== null);
}

/** What a source's menu triggers target: every literal id, and whether one named an id the check cannot read. @public */
export function triggerTargets(source: string): { literal: Set<string>; opaque: boolean } {
  const targets = occurrences(source, /(?<!\/)Menu\.(?:Submenu)?Trigger\b/g).map((props) => literalProp(props, "for"));
  return { literal: new Set(targets.filter((target): target is string => target !== null)), opaque: targets.includes(null) };
}

// A trigger is a sibling element rather than a prop, so no `MenuPopupProps` variant can reject this.
// An id the check cannot read is skipped on either side, which makes the rule a net and not a proof.
/** Judges one source's `triggered` popups against the triggers rendered beside them. @public */
export function validateMenuNaming(file: string, source: string): Finding[] {
  const targets = triggerTargets(source);
  // One trigger aimed through a variable or a local helper leaves every popup in the file arguable,
  // so the file goes unjudged rather than reported on evidence the check does not have.
  if (targets.opaque) return [];
  const orphans = triggeredPopupIds(source).filter((id) => !targets.literal.has(id));
  if (orphans.length === 0) return [];

  return [
    fail("Menu.Popup names itself after a trigger that is not there", {
      file,
      detail: orphans.map((id) => `\`triggered\` on id "${id}" — nothing in this file renders "${id}-trigger"; use \`label\` instead`),
    }),
  ];
}

/** Walk the configured sources and judge every `triggered` menu popup in them. @public */
export function checkMenuNaming(config: MenuNamingCheckConfig): CheckResult {
  const sources = config.sources ?? ["src"];
  const files = sources.flatMap((dir) => collectFiles(config.root, dir, SCANNED)).map((file) => resolve(config.root, file));
  if (files.length === 0) return scannedNothing(`\`${sources.join("`, `")}\` matched no module`, "menu-naming");

  const findings = files.flatMap((file) => validateMenuNaming(relative(config.root, file), readFileSync(file, "utf-8")));

  if (findings.length > 0) {
    findings.push(fail("A `triggered` popup takes its accessible name from `${id}-trigger`, so something must render one."));
  }

  return checkResult(findings, `${files.length} modules pair every \`triggered\` menu popup with its trigger.`);
}
