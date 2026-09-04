import type { CssNode, DesignSystem } from "./design-system";

const box = (property: string, suffix: string): [string, string[]][] => [
  [
    `${property}${suffix}`,
    [
      `${property}-top${suffix}`,
      `${property}-right${suffix}`,
      `${property}-bottom${suffix}`,
      `${property}-left${suffix}`,
      `${property}-inline${suffix}`,
      `${property}-block${suffix}`,
      `${property}-inline-start${suffix}`,
      `${property}-inline-end${suffix}`,
      `${property}-block-start${suffix}`,
      `${property}-block-end${suffix}`,
    ],
  ],
  [
    `${property}-inline${suffix}`,
    [`${property}-left${suffix}`, `${property}-right${suffix}`, `${property}-inline-start${suffix}`, `${property}-inline-end${suffix}`],
  ],
  [
    `${property}-block${suffix}`,
    [`${property}-top${suffix}`, `${property}-bottom${suffix}`, `${property}-block-start${suffix}`, `${property}-block-end${suffix}`],
  ],
];

/** Every CSS shorthand whose longhands a property-level view cannot see, physical and logical alike. */
export const SHORTHAND_CLOSURE: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ...box("padding", ""),
  ...box("margin", ""),
  [
    "inset",
    [
      "top",
      "right",
      "bottom",
      "left",
      "inset-inline",
      "inset-block",
      "inset-inline-start",
      "inset-inline-end",
      "inset-block-start",
      "inset-block-end",
    ],
  ],
  ["inset-inline", ["left", "right", "inset-inline-start", "inset-inline-end"]],
  ["inset-block", ["top", "bottom", "inset-block-start", "inset-block-end"]],
  ["gap", ["row-gap", "column-gap"]],
  ["overflow", ["overflow-x", "overflow-y"]],
  ["overscroll-behavior", ["overscroll-behavior-x", "overscroll-behavior-y"]],
  [
    "border-radius",
    [
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-right-radius",
      "border-bottom-left-radius",
      "border-start-start-radius",
      "border-start-end-radius",
      "border-end-end-radius",
      "border-end-start-radius",
    ],
  ],
  ...box("border", "-width"),
  ...box("border", "-color"),
  ...box("border", "-style"),
  ...box("scroll-padding", ""),
  ...box("scroll-margin", ""),
  ["flex", ["flex-grow", "flex-shrink", "flex-basis"]],
  ["place-content", ["align-content", "justify-content"]],
  ["place-items", ["align-items", "justify-items"]],
  ["place-self", ["align-self", "justify-self"]],
]);

function collect(nodes: readonly CssNode[], into: Set<string>): void {
  for (const node of nodes) {
    if (node.kind === "declaration") {
      if (node.property !== undefined) into.add(node.property);
    } else if (node.kind === "at-rule" && node.name === "@property") continue;
    else if (node.nodes !== undefined) collect(node.nodes, into);
  }
}

/** The properties that identify a compiled utility: its `--tw-*` variables when it sets any, else its CSS properties. */
export function signature(nodes: readonly CssNode[]): string {
  const properties = new Set<string>();
  collect(nodes, properties);
  const vars = [...properties].filter((property) => property.startsWith("--tw-"));
  const real = [...properties].filter((property) => !property.startsWith("--"));
  return (vars.length > 0 ? vars : real).sort().join(",");
}

/** Every property a group reaches once CSS shorthands are expanded. */
export function reach(group: string): ReadonlySet<string> {
  const out = new Set(group.split(","));
  const queue = [...out];
  while (queue.length > 0) {
    for (const child of SHORTHAND_CLOSURE.get(queue.pop() as string) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return out;
}

/** One functional root's resolution: its named default, the value set that takes the other group, and its arbitrary-value groups. @public */
export interface RootRow {
  /** Group for a named value the design system did not enumerate; absent when the root takes no named value. */
  named?: string;
  /** The enumerated minority values, and the group they take. */
  exceptions?: { values: readonly string[]; group: string };
  /** Group for an arbitrary value whose kind is not listed in `kinds`. */
  arbitrary?: string;
  /** Arbitrary-value kinds that resolve to something other than `arbitrary`. */
  kinds?: Readonly<Record<string, string>>;
}

/** The derived table: every static utility, every functional root, and the override edges between groups. @public */
export interface ClassGroupTable {
  statics: ReadonlyMap<string, string>;
  roots: ReadonlyMap<string, RootRow>;
  overrides: ReadonlyMap<string, readonly string[]>;
}

const ARBITRARY_PROBES: readonly (readonly [string, string])[] = [
  ["color", "[#abcdef]"],
  ["length", "[3px]"],
  ["number", "[3]"],
  ["percentage", "[10%]"],
  ["url", "[url(a.png)]"],
  ["other", "[foo]"],
];

const SR_ONLY_GROUP = "sr-only";

const SCALE_ROOT = "text-size";

function tally(values: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function modal(counts: ReadonlyMap<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const [key, count] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

const bare = (root: string): string => (root.startsWith("-") ? root.slice(1) : root);

// `getClassList()` enumerates a scale for `left` and nothing for `start`, so a root it leaves empty
// is asked directly whether it takes a scale value — as the bare roots above already are.
const SCALE_PROBES: readonly string[] = ["0", "4"];

function deriveOverrides(groups: readonly string[]): Map<string, readonly string[]> {
  const reaches = new Map(groups.map((group) => [group, reach(group)]));
  const out = new Map<string, readonly string[]>();
  for (const group of groups) {
    const own = reaches.get(group) as ReadonlySet<string>;
    const covered = groups
      .filter((other) => {
        if (other === group) return false;
        const theirs = reaches.get(other) as ReadonlySet<string>;
        if (![...theirs].every((property) => own.has(property))) return false;
        if (theirs.size === own.size) {
          throw new Error(`Groups \`${group}\` and \`${other}\` reach the same properties, so an override edge between them would run both ways.`);
        }
        return true;
      })
      .sort();
    if (covered.length > 0) out.set(group, covered);
  }
  return out;
}

/** Reads every utility the design system knows and returns the conflict table `cn` resolves against. @public */
export function deriveClassGroups(ds: DesignSystem): ClassGroupTable {
  const signatures = (candidates: string[]): (string | undefined)[] =>
    ds.candidatesToAst(candidates).map((nodes) => (nodes !== null && nodes.length > 0 ? signature(nodes) : undefined));

  const statics = new Map<string, string>();
  const claim = (utility: string, group: string): void => {
    const name = bare(utility);
    const seen = statics.get(name);
    if (seen !== undefined && seen !== group) {
      throw new Error(`Utility \`${name}\` resolves to two signatures (\`${seen}\` and \`${group}\`) once its negative form is folded in.`);
    }
    statics.set(name, group);
  };

  const staticRoots = [...ds.utilities.keys("static")];
  const staticSignatures = signatures(staticRoots);
  for (let i = 0; i < staticRoots.length; i += 1) {
    const group = staticSignatures[i];
    if (group !== undefined) claim(staticRoots[i] as string, group);
  }

  const functional = [...new Set(ds.utilities.keys("functional").map(bare))].sort();

  const bareSignatures = signatures(functional);
  for (let i = 0; i < functional.length; i += 1) {
    const group = bareSignatures[i];
    if (group !== undefined) claim(functional[i] as string, group);
  }

  const named = new Map<string, Map<string, string>>(functional.map((root) => [root, new Map<string, string>()]));
  const classList = ds.getClassList().map(([name]) => name);
  const classSignatures = signatures(classList);
  for (let i = 0; i < classList.length; i += 1) {
    const group = classSignatures[i];
    if (group === undefined) continue;
    const candidate = [...ds.parseCandidate(classList[i] as string)][0];
    if (candidate === undefined || candidate.kind !== "functional") continue;
    const value = candidate.value;
    if (value === undefined || value === null || value.kind !== "named") continue;
    named.get(bare(candidate.root))?.set(value.value, group);
  }

  const unlisted = functional.filter((root) => (named.get(root) as Map<string, string>).size === 0);
  const scaleNames = unlisted.flatMap((root) => SCALE_PROBES.map((value) => `${root}-${value}`));
  const scaleSignatures = signatures(scaleNames);
  const scaleGroups = new Map<string, string>();
  for (let i = 0; i < unlisted.length; i += 1) {
    const found = new Set(SCALE_PROBES.map((_, j) => scaleSignatures[i * SCALE_PROBES.length + j]));
    const only = found.size === 1 ? [...found][0] : undefined;
    if (only !== undefined) scaleGroups.set(unlisted[i] as string, only);
  }

  statics.set("sr-only", SR_ONLY_GROUP);
  statics.set("not-sr-only", SR_ONLY_GROUP);

  const probeNames = functional.flatMap((root) => ARBITRARY_PROBES.map(([, probe]) => `${root}-${probe}`));
  const probeSignatures = signatures(probeNames);

  const roots = new Map<string, RootRow>();
  let cursor = 0;
  for (const root of functional) {
    const arbitraryGroups = new Map<string, string>();
    for (const [kind] of ARBITRARY_PROBES) {
      const group = probeSignatures[cursor];
      cursor += 1;
      if (group !== undefined) arbitraryGroups.set(kind, group);
    }

    const values = named.get(root) as Map<string, string>;
    const namedDefault = values.size > 0 ? modal(tally(values.values())) : scaleGroups.get(root);
    const arbitraryDefault = modal(tally(arbitraryGroups.values()));
    if (namedDefault === undefined && arbitraryDefault === undefined) continue;

    const row: RootRow = {};
    if (namedDefault !== undefined) {
      row.named = namedDefault;
      const minority = [...values].filter(([, group]) => group !== namedDefault);
      if (minority.length > 0) {
        const groups = new Set(minority.map(([, group]) => group));
        if (groups.size > 1) {
          throw new Error(`Functional root \`${root}\` spans ${groups.size + 1} signatures; the table encodes at most two per root.`);
        }
        row.exceptions = { values: minority.map(([value]) => value).sort(), group: [...groups][0] as string };
      }
    }
    if (arbitraryDefault !== undefined) {
      row.arbitrary = arbitraryDefault;
      const kinds = Object.fromEntries([...arbitraryGroups].filter(([, group]) => group !== arbitraryDefault));
      if (Object.keys(kinds).length > 0) row.kinds = kinds;
    }
    roots.set(root, row);
  }

  const textRow = roots.get("text");
  const fontSize = textRow?.exceptions?.group;
  if (fontSize !== undefined && !roots.has(SCALE_ROOT)) {
    const arbitrary = textRow?.kinds?.["length"] ?? textRow?.arbitrary;
    roots.set(SCALE_ROOT, arbitrary === undefined ? { named: fontSize } : { named: fontSize, arbitrary });
  }

  const groups = new Set<string>(statics.values());
  for (const row of roots.values()) {
    for (const group of [row.named, row.arbitrary, row.exceptions?.group, ...Object.values(row.kinds ?? {})]) {
      if (group !== undefined) groups.add(group);
    }
  }

  const ordered = new Map([...roots].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  return { statics, roots: ordered, overrides: deriveOverrides([...groups].sort()) };
}

const quote = (value: string): string => JSON.stringify(value);

function interner(): { index: (key: string) => number; all: readonly string[] } {
  const keys: string[] = [];
  return {
    index: (key: string): number => {
      const found = keys.indexOf(key);
      if (found !== -1) return found;
      keys.push(key);
      return keys.length - 1;
    },
    all: keys,
  };
}

function renderRoots(table: ClassGroupTable): { valueSets: string; roots: string } {
  const sets = interner();

  const rows = [...table.roots].map(([root, row]) => {
    const parts: string[] = [];
    if (row.named !== undefined) parts.push(`n: ${quote(row.named)}`);
    if (row.exceptions !== undefined) parts.push(`x: [${sets.index(row.exceptions.values.join(" "))}, ${quote(row.exceptions.group)}]`);
    if (row.arbitrary !== undefined) parts.push(`a: ${quote(row.arbitrary)}`);
    if (row.kinds !== undefined) {
      const kinds = Object.entries(row.kinds).map(([kind, group]) => `${kind}: ${quote(group)}`);
      parts.push(`k: { ${kinds.join(", ")} }`);
    }
    return `  [${quote(root)}, { ${parts.join(", ")} }]`;
  });

  return { valueSets: sets.all.map((set) => `  [${set.split(" ").map(quote).join(", ")}]`).join(",\n"), roots: rows.join(",\n") };
}

const BANNER = "/** class-groups.ts — GENERATED — do not edit; run `bun run gen:class-groups`. */";

const RESOLVER = `interface RootRow {
  readonly n?: string;
  readonly x?: readonly [number, string];
  readonly a?: string;
  readonly k?: Readonly<Record<string, string>>;
}

const SETS: readonly ReadonlySet<string>[] = VALUE_SETS.map((values) => new Set(values));

const COLOR_FUNCTIONS = ["rgb(", "rgba(", "hsl(", "hsla(", "oklch(", "oklab(", "lab(", "lch(", "color(", "color-mix("];
const LENGTH = /^-?[\\d.]+(?:px|rem|em|ch|ex|vw|vh|vmin|vmax|pt|pc|in|cm|mm|q)$/;
const NUMBER = /^-?[\\d.]+$/;
const PERCENTAGE = /^-?[\\d.]+%$/;

function arbitraryKind(value: string): string {
  const inner = value.slice(1, -1);
  const colon = inner.indexOf(":");
  if (colon !== -1) return inner.slice(0, colon);
  if (inner.startsWith("#") || COLOR_FUNCTIONS.some((fn) => inner.startsWith(fn))) return "color";
  if (inner.startsWith("url(")) return "url";
  if (LENGTH.test(inner)) return "length";
  if (PERCENTAGE.test(inner)) return "percentage";
  if (NUMBER.test(inner)) return "number";
  return "other";
}

function rootGroup(row: RootRow, value: string): string | undefined {
  if (value.startsWith("[") || value.startsWith("(")) return row.k?.[arbitraryKind(value)] ?? row.a;
  if (row.x !== undefined && (SETS[row.x[0]] as ReadonlySet<string>).has(value)) return row.x[1];
  return row.n;
}

/** Names the CSS concern a modifier-stripped utility sets, or \`undefined\` when it is outside the table. @internal */
export function classGroup(utility: string): string | undefined {
  if (utility.length === 0) return undefined;

  if (utility.startsWith("[")) {
    const colon = utility.indexOf(":");
    return colon === -1 ? undefined : \`arb:\${utility.slice(1, colon)}\`;
  }

  const bare = utility.startsWith("-") ? utility.slice(1) : utility;

  const exact = STATIC_GROUPS.get(bare);
  if (exact !== undefined) return exact;

  // Longest root wins, so \`text-shadow-md\` is read as a shadow rather than as a colour.
  for (let i = bare.length - 1; i > 0; i -= 1) {
    if (bare[i] !== "-") continue;
    const row = ROOT_GROUPS.get(bare.slice(0, i));
    if (row !== undefined) return rootGroup(row, bare.slice(i + 1));
  }

  return undefined;
}`;

/** Renders the derived table as the `class-groups.ts` module source, banner and resolver included. @public */
export function renderClassGroups(table: ClassGroupTable): string {
  const statics = [...table.statics]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([name, group]) => `  [${quote(name)}, ${quote(group)}]`)
    .join(",\n");
  const { valueSets, roots } = renderRoots(table);
  const overrides = [...table.overrides].map(([group, covered]) => `  [${quote(group)}, [${covered.map(quote).join(", ")}]]`).join(",\n");

  return [
    BANNER,
    "",
    "const STATIC_GROUPS: ReadonlyMap<string, string> = new Map<string, string>([",
    `${statics},`,
    "]);",
    "",
    "const VALUE_SETS: readonly (readonly string[])[] = [",
    `${valueSets},`,
    "];",
    "",
    "const ROOT_GROUPS: ReadonlyMap<string, RootRow> = new Map<string, RootRow>([",
    `${roots},`,
    "]);",
    "",
    "/** One-directional override edges: accepting a shorthand marks its longhands consumed, never the reverse. */",
    "export const GROUP_OVERRIDES: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([",
    `${overrides},`,
    "]);",
    "",
    RESOLVER,
    "",
  ].join("\n");
}
