import type { Tree } from "../types";

/** A bridge table: each term a reader might type, mapped to the terms the corpus files it under. @public */
export type AliasTable = ReadonlyMap<string, readonly string[]>;

/** Paraphrase bridges every repository earns, whatever tree it is subject to. @public */
export const SHARED: AliasTable = new Map([
  ["put", ["growth", "namespace", "belongs"]],
  ["belong", ["growth", "namespace"]],
  ["belongs", ["growth", "namespace"]],
  ["goes", ["growth", "namespace", "belongs"]],
  ["live", ["growth", "namespace", "belongs"]],
  ["lives", ["growth", "namespace", "belongs"]],
  ["home", ["growth", "namespace", "belongs"]],
  ["new", ["growth", "adding"]],
  ["throw", ["Result", "err", "ok"]],
  ["throws", ["Result", "err", "ok"]],
  ["exception", ["Result", "err", "ok"]],
  ["crash", ["error", "boundary", "fail-closed"]],
  ["500", ["error", "boundary"]],
  ["error", ["Result", "taxonomy"]],
  ["logging", ["channel", "PII"]],
  ["log", ["channel"]],
  ["pii", ["redaction"]],
  ["secret", ["binding", "env", "PII"]],
  // `key` reaches `credential` and never `secret`: `secret` is also the placement question's word,
  // so bridging onto it displaces the namespace that owns a key's lifecycle.
  ["key", ["credential"]],
  ["credential", ["secret"]],
  ["believe", ["evidence", "trusted"]],
  ["finding", ["output", "report"]],
  ["auth", ["session", "csrf", "origin"]],
  ["login", ["session", "auth"]],
  ["permission", ["guard", "middleware"]],
  ["csrf", ["token", "form", "guard"]],
  ["captcha", ["turnstile"]],
  ["bot", ["turnstile"]],
  ["cors", ["origin", "transport"]],
  ["header", ["headers", "security", "csp"]],
  ["nonce", ["csp"]],
  ["style", ["class", "cn", "utility"]],
  ["css", ["utility", "layer", "token"]],
  ["colour", ["scheme", "theme"]],
  ["color", ["scheme", "theme"]],
  ["dark", ["scheme", "theme", "light-dark"]],
  ["spacing", ["scale", "token"]],
  ["component", ["props", "slot"]],
  ["props", ["prop"]],
  ["form", ["validation", "schema", "csrf"]],
  ["validate", ["validation", "schema", "boundary"]],
  ["schema", ["validation"]],
  ["database", ["storage", "binding"]],
  ["cache", ["KV", "storage"]],
  ["upload", ["storage"]],
  ["route", ["router", "controller", "middleware"]],
  ["handler", ["controller"]],
  ["test", ["testing", "co-location", "fake"]],
  ["mock", ["fake", "testing"]],
  ["comment", ["comment budget", "TSDoc"]],
  ["docs", ["governing", "document", "citation"]],
  ["build", ["tooling", "pipeline", "asset"]],
  ["release", ["changelog", "version"]],
  ["lint", ["rule", "gate"]],
  ["gate", ["verify", "step", "check"]],
]);

/** Bridges whose targets are the library's own vocabulary — its exports, its namespaces, and its classification. @public */
export const LIBS: AliasTable = new Map([
  ["belong", ["classification"]],
  ["belongs", ["classification"]],
  ["nonce", ["script-src"]],
  ["logging", ["requestLogger"]],
  ["log", ["requestLogger"]],
  ["style", ["cva"]],
  ["colour", ["color", "oklch"]],
  ["color", ["oklch"]],
  ["component", ["ui/core"]],
  ["props", ["vocabulary"]],
  ["button", ["ui/core", "asChild", "data-slot"]],
  ["schema", ["valibot"]],
  ["database", ["D1"]],
  ["upload", ["R2"]],
  ["handler", ["definePage", "defineAction"]],
  ["release", ["semver"]],
  ["lint", ["oxlint"]],
]);

/** Bridges an application's corpus earns and a library's does not. @public */
export const APPS: AliasTable = new Map<string, readonly string[]>([]);

/** The bridges a repository of `kind` is served — the shared table plus its own tree's. @public */
export function aliasesFor(kind: Tree): AliasTable {
  const merged = new Map<string, readonly string[]>(SHARED);
  for (const [term, targets] of kind === "libs" ? LIBS : kind === "apps" ? APPS : new Map()) {
    merged.set(term, [...(merged.get(term) ?? []), ...(targets as readonly string[])]);
  }
  return merged;
}

/** Every bridge in the file, whatever tree it belongs to. @public */
export const ALIASES: AliasTable = (() => {
  const merged = new Map<string, readonly string[]>(SHARED);
  for (const table of [LIBS, APPS]) {
    for (const [term, targets] of table) merged.set(term, [...(merged.get(term) ?? []), ...targets]);
  }
  return merged;
})();

/** The extra terms a query earns, deduplicated and never including a term the reader already typed. @public */
export function aliasTerms(terms: readonly string[], aliases: AliasTable = ALIASES): string[] {
  const typed = new Set(terms.map((term) => term.toLowerCase()));
  const extra = new Set<string>();
  for (const term of typed) {
    for (const alias of aliases.get(term) ?? []) {
      if (!typed.has(alias.toLowerCase())) extra.add(alias);
    }
  }
  return [...extra].sort();
}
