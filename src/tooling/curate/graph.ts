import { CliError } from "../cli/errors";
import { definitionList } from "../term/grid";
import type { FeatureGraph, FeatureManifest, FeatureResolution, FeatureSelection } from "./types";

/** Backticked names, comma-joined, as every curation refusal lists them. @internal */
export function quoteList(names: readonly string[]): string {
  return names.map((name) => `\`${name}\``).join(", ");
}

function requirementsOf(config: FeatureManifest, feature: string): readonly string[] {
  return config[feature]?.requires ?? [];
}

function assertKnownRequirements(config: FeatureManifest, features: readonly string[]): void {
  for (const feature of features) {
    for (const requirement of requirementsOf(config, feature)) {
      if (requirement === feature) throw new CliError("invalid-args", `feature \`${feature}\` requires itself`);
      if (!features.includes(requirement)) {
        throw new CliError(
          "invalid-args",
          `feature \`${feature}\` requires unknown feature \`${requirement}\` — the manifest names ${quoteList(features)}`,
        );
      }
    }
  }
}

function assertAcyclic(config: FeatureManifest, features: readonly string[]): void {
  const finished = new Set<string>();
  const path: string[] = [];
  const visit = (feature: string): void => {
    if (finished.has(feature)) return;
    const revisited = path.indexOf(feature);
    if (revisited !== -1) {
      const cycle = [...path.slice(revisited), feature].map((name) => `\`${name}\``).join(" → ");
      throw new CliError(
        "invalid-args",
        `features ${cycle} require one another — a feature graph has no cycles; merge them, or move what they share into a feature both require`,
      );
    }
    path.push(feature);
    for (const requirement of requirementsOf(config, feature)) visit(requirement);
    path.pop();
    finished.add(feature);
  };
  for (const feature of features) visit(feature);
}

function topologicalOrder(config: FeatureManifest, features: readonly string[]): string[] {
  const order: string[] = [];
  while (order.length < features.length) {
    const next = features.find((feature) => !order.includes(feature) && requirementsOf(config, feature).every((name) => order.includes(name)));
    if (next === undefined) break;
    order.push(next);
  }
  return order;
}

/** Reads the manifest's requirement edges, refusing an unknown requirement, a feature requiring itself, and a cycle. @internal */
export function featureGraph(config: FeatureManifest): FeatureGraph {
  const features = Object.keys(config);
  assertKnownRequirements(config, features);
  assertAcyclic(config, features);

  const order = topologicalOrder(config, features);
  const requiredBy = new Map(features.map((feature) => [feature, features.filter((other) => requirementsOf(config, other).includes(feature))]));
  const closure = new Map<string, Set<string>>();
  for (const feature of order) {
    const reached = new Set<string>();
    for (const requirement of requirementsOf(config, feature)) {
      reached.add(requirement);
      for (const indirect of closure.get(requirement) ?? []) reached.add(indirect);
    }
    closure.set(feature, reached);
  }
  return { order, requiredBy, closure };
}

/** Resolves a selection: a kept feature keeps what it requires, and a dropped feature drops what requires it. @internal */
export function resolveFeatures(config: FeatureManifest, selection: FeatureSelection): FeatureResolution {
  const graph = featureGraph(config);
  const features = Object.keys(config);
  const mode = "keep" in selection ? "keep" : "drop";
  const named = "keep" in selection ? selection.keep : selection.drop;
  for (const feature of named) {
    if (!features.includes(feature)) {
      throw new CliError("invalid-args", `cannot ${mode} unknown feature \`${feature}\` — the manifest names ${quoteList(features)}`);
    }
  }

  const closureOf = (feature: string): ReadonlySet<string> => graph.closure.get(feature) ?? new Set();
  const selected = new Set(
    mode === "keep"
      ? named.flatMap((feature) => [feature, ...closureOf(feature)])
      : features.filter((feature) => named.includes(feature) || named.some((dropped) => closureOf(feature).has(dropped))),
  );
  const kept = features.filter((feature) => (mode === "keep") === selected.has(feature));
  const dropped = features.filter((feature) => !kept.includes(feature));
  const added = features
    .filter((feature) => selected.has(feature) && !named.includes(feature))
    .map((feature) => {
      const neighbours = mode === "keep" ? (graph.requiredBy.get(feature) ?? []) : requirementsOf(config, feature);
      return { feature, because: features.filter((other) => neighbours.includes(other) && selected.has(other)) };
    });
  return { mode, kept, dropped, added };
}

/** The `forge curate --list` rows: each feature in requirement order, with its direct edges and any regeneration it declares. @internal */
export function describeFeatureGraph(config: FeatureManifest): string[] {
  const graph = featureGraph(config);
  const entries = graph.order.map((feature) => {
    const requires = [...new Set(requirementsOf(config, feature))];
    const requiredBy = graph.requiredBy.get(feature) ?? [];
    const regenerate = config[feature]?.regenerate;
    const parts = [
      requires.length === 0 ? "requires nothing" : `requires ${requires.join(", ")}`,
      requiredBy.length === 0 ? "required by nothing" : `required by ${requiredBy.join(", ")}`,
      ...(regenerate === undefined ? [] : [`regenerates with \`${regenerate.run.join(" ")}\``]),
    ];
    return { term: `${feature}:`, description: parts.join("; ") };
  });
  return definitionList(entries, { indent: 2, gap: 1 });
}
