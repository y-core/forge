/** namespace-graph.ts — the authoritative declaration of forge's namespace dependency graph.
 *
 *  **This file, not `.decisions/NAMESPACE_DESIGN.md`, is authoritative.** The document cites it and
 *  enumerates nothing: there is no leaf list and no `Namespace | Composes` table there to fall out
 *  of step with the tree, because a second enumeration is indistinguishable from an amendment once
 *  the two disagree.
 *
 *  The inversion runs the other way from the rest of `.decisions/`, and deliberately. The
 *  alternative — leaving the prose authoritative and having the gate parse it — buys a
 *  human-readable source of truth at the price of a markdown parser standing between the rule and
 *  its enforcement: reflowing a table, splitting a long cell, or switching a separator would fail
 *  the gate on a change nobody thought was semantic, and the pressure that creates is to weaken the
 *  parser until it stops asserting anything. Declaring the graph as data removes the parser
 *  entirely. What the document keeps is the part prose is better at: *why* each classification
 *  holds.
 *
 *  Every entry here is reviewed, not scraped. A row is a statement that the edge is intended.
 */

import type { EdgeKind } from "./namespace-graph-parse";

/** Namespaces any other namespace may import without that import counting as an edge.
 *
 *  The exemption is on the *target* only. The set is closed — every edge out of a primitive lands
 *  inside the set — and `validate-namespace-graph.ts` enforces that closure rather than trusting
 *  it, because a primitive that reached into a consumer would put every consumer behind that
 *  consumer. */
export const PRIMITIVES: readonly string[] = ["context", "crypto", "result", "validation"];

/** Namespaces declared to have zero cross-namespace edges beyond the primitives above.
 *
 *  A leaf is the strongest claim in the graph and the cheapest to break: one convenience import and
 *  the namespace is silently integration. Declaring the absence is what makes the break visible. */
export const LEAF: readonly string[] = [
  "assets/manifest",
  "cli",
  "config",
  "context",
  "form",
  "html/htmx",
  "http",
  "result",
  "router",
  "session",
  "storage/r2",
  "ui/contracts",
  "validation",
];

/** Every declared cross-namespace edge: source → target → whether it survives type erasure.
 *
 *  A `type` edge is erased at emit and so cannot close a runtime cycle, but it is still a coupling
 *  a rename breaks — so it is declared rather than omitted, and the distinction is enforced in both
 *  directions. Imports of `PRIMITIVES` are not edges and do not appear. */
export const EDGES: Record<string, Record<string, EdgeKind>> = {
  app: { config: "value", form: "value", http: "value", logging: "value", security: "value" },
  assets: { "assets/build": "value", cli: "value" },
  // The config types it builds from — no runtime edge at all.
  "assets/build": { assets: "type" },
  jsx: { http: "value" },
  // Type-only in this direction on purpose: `storage/kv → logging` is the runtime edge, and making
  // this one a value import would close a real cycle.
  logging: { "storage/kv": "type" },
  "logging/show": { "html/htmx": "value", http: "value", jsx: "value", logging: "value", "ui/core": "value" },
  pkg: { cli: "value" },
  security: { logging: "value" },
  "storage/db": { logging: "value" },
  "storage/kv": { logging: "value" },
  testing: { app: "type", form: "value", jsx: "value", logging: "value", "storage/db": "type", "storage/kv": "type", "storage/r2": "type" },
  "ui/assets": { assets: "type" },
  "ui/chrome": { jsx: "type", "ui/client": "value", "ui/contracts": "value", "ui/core": "value", "ui/server": "value" },
  "ui/client": { "ui/contracts": "value" },
  "ui/controls": { jsx: "type", "ui/contracts": "value", "ui/core": "value", "ui/server": "value" },
  "ui/core": { form: "value", jsx: "value", "ui/client": "value", "ui/contracts": "value" },
  "ui/server": { "html/htmx": "value", jsx: "type", session: "value", "ui/core": "value" },
  "ui/show": {
    app: "value",
    "html/htmx": "value",
    http: "value",
    jsx: "value",
    "ui/chrome": "value",
    "ui/client": "value",
    "ui/core": "value",
    "ui/server": "value",
  },
  "validation/cli": { cli: "value" },
};
