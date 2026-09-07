/** Paraphrase bridges for the queries lexical retrieval alone cannot reach.
 *
 *  This is the one thing embeddings would buy that BM25 does not, and it is bought here instead:
 *  a curated table is auditable, deterministic, and costs no provider, no network and no gate step
 *  that can fail on an expired proxy rule. Each entry is OR-ed in at low weight and never replaces
 *  the reader's own terms, so a precise query is never diluted by one. @public */
export const ALIASES: ReadonlyMap<string, readonly string[]> = new Map([
  // Placement. "Where does this go?" is the highest-stakes question asked of this corpus — the
  // answer decides which namespace code lands in — and it is the one lexical retrieval served
  // worst, because the sections that answer it are titled after the namespace rather than after
  // the asking. These reach the growth rules and the classification sections by the words those
  // sections are filed under.
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
