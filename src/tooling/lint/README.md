---
title: The Lint Plugin and Rule Catalogs
description: "Forge's oxlint plugin of AST-anchored rules, and the catalogs that tie each rule id to the design-corpus file justifying it."
audience: internal
---

# `@y-core/forge/tooling/lint`

Name one subpath in `.oxlintrc.json` and oxlint gains forge's rules under the `forge/` prefix. They are read off the AST, so a class list bound to a
module-scope const and passed by name is judged like an inline literal.

Beside the plugin sit its rule catalogs — plain data answering "which document states this rule, and what enforces it?" without opening either side.

**A leaf namespace.** It imports nothing from another forge namespace, and reaches for no Node built-in; the plugin is loaded by oxlint, and the
catalogs are data.

```ts
import { corpusIdOf, lintKeyOf, modernCssRule, RULE_CORPUS_PATH, RULE_ENFORCER } from "@y-core/forge/tooling/lint";
```

Every rule id, its permanence, and the boundary between the design corpus, this register and the gate are [`UI_DESIGN_GUIDANCE.md`][udg-3] §3's;
this file teaches the use.

---

## Getting started

```jsonc
{
  "plugins": ["eslint", "typescript", "unicorn", "oxc", "import", "promise", "jsx-a11y"],
  "jsPlugins": ["@y-core/forge/tooling/lint/plugin"],
  "rules": {
    "forge/color-token-only": "error",
    "forge/spacing-scale-only": "error",
    "forge/suppression-needs-reason": "error",
  },
}
```

That subpath is the whole installation — no bundling step and no `esbuild` of your own. It resolves to a committed bundle, which is what a consumer
can load; both spellings export the plugin as `lintPlugin` and as the default export, and oxlint reads the default.

**Every rule is off until you name it.** The plugin registers them; your config decides which ones run and at what severity. `meta.name` is
`"forge"`, which is where the prefix comes from.

---

## Choosing which rules to turn on

| Rule key | Corpus id | Reports |
| --- | --- | --- |
| `a11y-aria-beside-data` | `forge-ui-a11y-aria-beside-data` | An `aria-*` state hook written by hand rather than emitted through `stateAttrs` |
| `a11y-heading-size-by-class` | `forge-ui-a11y-heading-size-by-class` | A heading whose level was picked for its size rather than for the outline |
| `a11y-label-association` | `forge-ui-a11y-label-association` | A `<label>` with neither a `for` nor a wrapped control |
| `a11y-live-politeness` | `forge-ui-a11y-live-politeness` | An `aria-live` that is not `polite`, or an `assertive` that states no reason |
| `a11y-no-aria-readonly-on-button` | `forge-ui-a11y-no-aria-readonly-on-button` | `aria-readonly` on a role that carries no such state |
| `a11y-one-live-region` | `forge-ui-a11y-one-live-region` | A second live region beside the page's one announcer |
| `catalog-wrong-raw-input` | `forge-ui-catalog-wrong-raw-input` | A raw control in composed markup where the component wrapping it belongs |
| `color-theme-no-raw-utility` | `forge-ui-color-theme-no-raw-utility` | A raw palette utility with no `dark:` counterpart in the same class list |
| `color-token-only` | `forge-ui-color-token-only` | A colour utility naming a raw palette value instead of a theme token |
| `data-slot-before-spread` | — | A literal `data-slot` written before a bare-identifier spread that clobbers it |
| `exact-markup-assertion` | — | `toContain`, `toMatch` or `.includes` on markup a render produced |
| `focus-ring` | `forge-ui-focus-ring` | An outline suppressed on a pointer target with no `focus-visible:` ring replacing it |
| `interaction-focus-visible` | `forge-ui-interaction-focus-visible` | A bare `focus:` variant, which paints on a pointer press too |
| `no-inline-style` | `forge-ui-no-inline-style` | An inline `style=` attribute, which the renderer drops |
| `no-nested-card` | `forge-ui-no-nested-card` | A `<Card>` opened inside a `<Card.Content>` |
| `optional-prop-undefined` | `forge-ui-optional-prop-undefined` | A bare `?:` on a consumer-constructed type under `exactOptionalPropertyTypes` |
| `platform-entry-motion` | `forge-ui-platform-entry-motion` | A class added on the next frame where `@starting-style` expresses the entry |
| `platform-logical-spacing` | `forge-ui-platform-logical-spacing` | Physical inline-axis spacing where the logical pair exists |
| `platform-text-balance` | `forge-ui-platform-text-balance` | Manual line balancing in place of `text-wrap: balance` |
| `platform-text-pretty` | `forge-ui-platform-text-pretty` | Orphan control in place of `text-wrap: pretty` |
| `reduced-motion` | `forge-ui-reduced-motion` | Authored motion with no `motion-safe:` / `motion-reduce:` pair |
| `spacing-scale-only` | `forge-ui-spacing-scale-only` | A spacing value off the declared design scale |
| `sql-explicit-transaction` | — | A runtime `sql` fragment opening or closing a transaction — `batch()` is the boundary |
| `suppression-needs-reason` | — | An `oxlint-disable*` comment that gives no reason |
| `type-import-external` | — | An exported interface or type alias declared outside its directory's `types.ts` |
| `type-import-separation` | — | A `type` specifier riding inside a value import rather than its own `import type` line |

A rule with no corpus id states no design rule, so the register names none of it. Most of those are rulings from elsewhere in forge's
governance: `exact-markup-assertion` is [`TEST_RUNNERS.md`][testing-3e] §3e's, `sql-explicit-transaction` is [`STORAGE_BINDINGS.md`][sb-1g] §1g's
rule for runtime code, and `type-import-external` and `type-import-separation` are the halves of [`FORGE_STRUCTURE.md`][la-8] §8.
`data-slot-before-spread` is the ordering half of the JSX contract, and `suppression-needs-reason` covers every rule rather than only the design
ones — `oxlint --type-aware` already fails a stale suppression, and this one asks a live suppression to say why it is one.

`color-token-only` and `spacing-scale-only` read their vocabularies from `src/tooling/lint/data/design-scale.ts`, a generated file. Regenerate it
with `bun run gen:design-scale`; the gate's `validate-design-scale` step fails on any drift from the compiled stylesheet.

---

## Scoping a rule to part of the tree

Some rules are local to a slice of the tree rather than universal, and an `overrides` entry is how you say so:

```jsonc
{ "overrides": [{ "files": ["src/ui/core/*.tsx"], "rules": { "forge/optional-prop-undefined": "error" } }] }
```

Forge scopes these that way rather than turning them on everywhere: `optional-prop-undefined` to the components a consumer constructs prop values
for, `catalog-wrong-raw-input` to the log viewer and the auth views, `exact-markup-assertion` to `src/ui`'s test files, and
`sql-explicit-transaction` everywhere except `src/tooling` and the specs. Read `.oxlintrc.json` for the current scoping — it is the file the gate
holds the register against.

---

## Suppressing a finding

A suppression has to say why, because `suppression-needs-reason` reports one that does not. Append ` -- <reason>` to the directive:

```ts
// oxlint-disable-next-line forge/color-token-only -- brand lockup, fixed by the trademark guidelines
```

Name the rule rather than suppressing everything. A bare `oxlint-disable` with no rule names is reported the same way, and reads as a blanket
exemption nobody can judge later.

---

## Citing the rule behind a finding

The register turns a rule id into the document that justifies it, and back again:

```ts
import { corpusIdOf, lintKeyOf, RULE_CORPUS_PATH, RULE_ENFORCER } from "@y-core/forge/tooling/lint";

RULE_CORPUS_PATH["forge-ui-color-token-only"]; // "src/ui/design/floor.md"
RULE_ENFORCER["forge-ui-color-token-only"]; // "lint"

lintKeyOf("forge-ui-color-token-only"); // "color-token-only" — the oxlint rule key
corpusIdOf("color-token-only"); // "forge-ui-color-token-only" | undefined
```

The `forge-ui-` prefix is the whole of the mapping, and `validate-design` fails when the register and `.oxlintrc.json` disagree, so a rule cannot
drift away from the document that states it.

`RULE_ENFORCER` says which side a row is held against: a `gate` rule against the gate's own detectors, a `lint` rule against `.oxlintrc.json`, and
`contrast` against the measured colour pairs.

---

## Reading a platform-CSS rule

The modern-CSS catalog carries what the check knows about a rule beyond detecting it — how detectable it is, whether it blocks, the platform feature
that replaces the pattern, and what a human confirms before taking the replacement:

```ts
import { modernCssRule } from "@y-core/forge/tooling/lint";

const rule = modernCssRule("forge-ui-platform-aspect-ratio");
rule.tier; // "A" — textual detection; "B" and "C" need rendered behaviour
rule.severity; // "fail" blocks the gate, "warn" survives a passing step
rule.replacement; // "aspect-ratio"
rule.verify; // what to confirm by hand before taking it
```

`modernCssRule` resolves an id from either catalog: **a pattern the corpus already names is reported under the id it already has**, never under a
second one minted here. `MODERN_CSS_RULES` holds the minted ids and `MODERN_CSS_CITED_RULES` the borrowed ones.

A rule carrying `enforcer: "lint"` is one this plugin catches in source rather than the gate catching it in a stylesheet. An absent `enforcer` means
the gate.

---

## Working on the plugin inside forge

Forge loads the plugin from its source, `./src/tooling/lint/mod.ts`: it has no copy of itself under `node_modules`, so the restriction that forces
the bundle does not apply and a rule edit takes effect with nothing regenerated.

`plugin.mjs` — the file a consumer loads — is generated. Run `bun run gen:bundles` in the same commit as any rule change; the gate's
`validate-lint-plugin` step re-bundles the source and fails on the drift otherwise.

---

## See also

- [`@y-core/forge/tooling/gate`][gate-readme] — `validate-design`, `validate-modern-css` and `validate-design-scale`, the steps that read
  these catalogs
- [`UI_DESIGN_GUIDANCE.md`][udg-3] §3, §4 and §5 — the stable rule-id scheme, the anti-drift gate contract, and where a new design rule is written

[gate-readme]: ../gate/README.md
[la-8]: ../../../docs/FORGE_STRUCTURE.md#8-type-declarations-live-in-typests
[sb-1g]: ../../../docs/STORAGE_BINDINGS.md#1g-transactions--batch-is-the-boundary
[testing-3e]: ../../../docs/TEST_RUNNERS.md#3e-forgeexact-markup-assertion--the-enforced-form
[udg-3]: ../../../docs/UI_DESIGN_GUIDANCE.md#3-rule-identifier-scheme
