/** Paraphrase bridges for the queries lexical retrieval alone cannot reach.
 *
 *  **Curated because the corpus cannot supply this, not merely because a provider would be
 *  inconvenient.** The convenience argument is weak — Random Indexing over these chunks is local,
 *  offline and deterministic, so it costs no provider and no network either. It was built and
 *  measured anyway: it recovers 36 of these 139 pairs at top-25, and fails hardest on the entries
 *  that matter most. `put` comes back as the HTTP verb, `home` as the home page, `live` as the ARIA
 *  region. That is structural, not a tuning miss. A governing document states rules and never asks
 *  questions, so the corpus holds only the words a rule is written in; what this table supplies is
 *  the mapping from the words a reader asks in onto those, and that mapping is not in the text to be
 *  learned from it. The six bridges the measurement did propose cost a golden query and gained
 *  nothing.
 *
 *  Each entry is OR-ed in at low weight and never replaces the reader's own terms, so a precise
 *  query is never diluted by one. `warden:queries` warns on a bridge reaching no chunk: a dead
 *  target is OR-ed into every query that triggers it and would never announce itself. @public */
export const ALIASES: ReadonlyMap<string, readonly string[]> = new Map([
  // Placement. "Where does this go?" is the highest-stakes question asked of this corpus — the
  // answer decides which namespace code lands in — and it was the one lexical retrieval served
  // worst, because the sections that answer it are titled after the namespace rather than after
  // the asking. These reach the growth rules and the classification sections by the words those
  // sections are filed under. `warden:queries` now reports the worst rank and thinnest coverage per
  // question type every run, and placement leads the rollup rather than trailing it — which is what
  // these bridges bought, and is the thing that goes first if one is deleted.
  ["put", ["growth", "namespace", "belongs"]],
  ["belong", ["growth", "namespace", "classification"]],
  ["belongs", ["growth", "namespace", "classification"]],
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
  ["logging", ["channel", "requestLogger", "no-PII"]],
  ["log", ["channel", "requestLogger"]],
  ["pii", ["no-PII", "redaction"]],
  ["secret", ["binding", "env", "no-PII"]],
  ["auth", ["session", "csrf", "origin-guard"]],
  ["login", ["session", "auth"]],
  ["permission", ["guard", "middleware"]],
  ["csrf", ["token", "form", "guard"]],
  ["captcha", ["turnstile"]],
  ["bot", ["honeypot", "turnstile"]],
  ["cors", ["origin", "transport"]],
  ["header", ["headers", "security", "csp"]],
  ["nonce", ["csp", "script-src"]],
  ["style", ["class", "cn", "cva", "utility"]],
  ["css", ["utility", "layer", "token"]],
  ["colour", ["color", "oklch", "scheme", "theme"]],
  ["color", ["oklch", "scheme", "theme"]],
  ["dark", ["scheme", "theme", "light-dark"]],
  ["spacing", ["scale", "token"]],
  ["component", ["ui/core", "props", "slot"]],
  ["props", ["prop", "vocabulary"]],
  ["button", ["ui/core", "asChild", "data-slot"]],
  ["form", ["validation", "schema", "csrf"]],
  ["validate", ["validation", "schema", "boundary"]],
  ["schema", ["valibot", "validation"]],
  ["database", ["D1", "storage", "binding"]],
  ["cache", ["KV", "storage"]],
  ["upload", ["R2", "storage"]],
  ["route", ["router", "controller", "middleware"]],
  ["handler", ["definePage", "defineAction", "controller"]],
  ["test", ["testing", "co-location", "fake"]],
  ["mock", ["fake", "testing"]],
  ["comment", ["comment budget", "TSDoc"]],
  ["docs", ["governing", "document", "citation"]],
  ["build", ["tooling", "pipeline", "asset"]],
  ["release", ["changelog", "semver", "version"]],
  ["lint", ["oxlint", "rule", "gate"]],
  ["gate", ["verify", "step", "check"]],
]);

/** The extra terms a query earns, deduplicated and never including a term the reader already typed. @public */
export function aliasTerms(terms: readonly string[]): string[] {
  const typed = new Set(terms.map((term) => term.toLowerCase()));
  const extra = new Set<string>();
  for (const term of typed) {
    for (const alias of ALIASES.get(term) ?? []) {
      if (!typed.has(alias.toLowerCase())) extra.add(alias);
    }
  }
  return [...extra].sort();
}
