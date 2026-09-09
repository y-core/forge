import type { Tree } from "../types";

/** A bridge table: each term a reader might type, mapped to the terms the corpus files it under. @public */
export type AliasTable = ReadonlyMap<string, readonly string[]>;

/** Paraphrase bridges every repository earns, whatever tree it is subject to.
 *
 *  **Curated because the corpus cannot supply this, not merely because a provider would be
 *  inconvenient.** The convenience argument is weak — Random Indexing over these chunks is local,
 *  offline and deterministic, so it costs no provider and no network either. It was built and
 *  measured anyway: it recovers 36 of these pairs at top-25, and fails hardest on the entries that
 *  matter most. `put` comes back as the HTTP verb, `home` as the home page, `live` as the ARIA
 *  region. That is structural, not a tuning miss. A governing document states rules and never asks
 *  questions, so the corpus holds only the words a rule is written in; what this table supplies is
 *  the mapping from the words a reader asks in onto those, and that mapping is not in the text to be
 *  learned from it. The six bridges the measurement did propose cost a golden query and gained
 *  nothing.
 *
 *  Each entry is OR-ed in at low weight and never replaces the reader's own terms, so a precise
 *  query is never diluted by one. `warden:queries` warns on a bridge reaching no chunk: a dead
 *  target is OR-ed into every query that triggers it and would never announce itself. @public */
export const SHARED: AliasTable = new Map([
  // Placement. "Where does this go?" is the highest-stakes question asked of this corpus — the
  // answer decides which namespace code lands in — and it was the one lexical retrieval served
  // worst, because the sections that answer it are titled after the namespace rather than after
  // the asking. These reach the growth rules and the classification sections by the words those
  // sections are filed under. `warden:queries` now reports the worst rank and thinnest coverage per
  // question type every run, and placement leads the rollup rather than trailing it — which is what
  // these bridges bought, and is the thing that goes first if one is deleted.
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
  // `no-PII` occurs once in the whole canon, in a frontmatter description, which is never indexed —
  // so the bridge was dead in every repository including the one that wrote it. The rule states
  // itself as `PII`, which is the term a chunk actually carries.
  ["logging", ["channel", "PII"]],
  ["log", ["channel"]],
  // A reader typing `pii` already matches the term the rule is written in — the tokenizer folds
  // case — so the only bridge worth having is to what the rule asks for instead.
  ["pii", ["redaction"]],
  ["secret", ["binding", "env", "PII"]],
  // `origin-guard` is a hyphenated spelling no document writes: the middleware is `originGuard` and
  // the rule is about the request's `origin`. One token the tokenizer keeps whole, spelled as the
  // prose spells it.
  ["auth", ["session", "csrf", "origin"]],
  ["login", ["session", "auth"]],
  ["permission", ["guard", "middleware"]],
  ["csrf", ["token", "form", "guard"]],
  ["captcha", ["turnstile"]],
  ["bot", ["turnstile"]],
  ["cors", ["origin", "transport"]],
  ["header", ["headers", "security", "csp"]],
  // `script-src` is a directive inside a policy, and only the library's own security documents
  // spell it; the rule everywhere else is filed under the policy.
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

/** Bridges whose targets are the library's own vocabulary — its exports, its namespaces, and the
 *  classification only a library makes.
 *
 *  **Split out because the same table was loaded everywhere and half of it reached nothing.** A
 *  bridge is OR-ed into every query that triggers its term, so one aimed at `definePage` in a
 *  repository with no `definePage` is pure noise on a real question, and `warden:queries` warned
 *  about it in a consumer where nobody could act on the warning: the table is the library's file. @public */
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

/** Bridges an application's corpus earns and a library's does not.
 *
 *  **Deliberately empty, and kept as a declared slot rather than an omission.** Every apps-tree
 *  bridge measured so far reaches a term the shared canon also carries, so it belongs above; this
 *  is where the first one that does not will go, and its absence is a measurement rather than an
 *  oversight. @public */
export const APPS: AliasTable = new Map<string, readonly string[]>([]);

/** The bridges a repository of `kind` is served — the shared table plus its own tree's.
 *
 *  A term may be bridged by both, so the two are merged rather than one shadowing the other. @public */
export function aliasesFor(kind: Tree): AliasTable {
  const merged = new Map<string, readonly string[]>(SHARED);
  for (const [term, targets] of kind === "libs" ? LIBS : kind === "apps" ? APPS : new Map()) {
    merged.set(term, [...(merged.get(term) ?? []), ...(targets as readonly string[])]);
  }
  return merged;
}

/** Every bridge in the file, whatever tree it belongs to — the default for a caller that names no
 *  tree, and the union a test holds the tables against. @public */
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
