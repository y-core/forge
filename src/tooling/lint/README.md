# `@y-core/forge/tooling/lint`

**forge's oxlint plugin, and the two rule catalogs the gate reads.** A consuming repository names
this subpath in `.oxlintrc.json`'s `jsPlugins` and gets twenty-three AST-anchored rules under the `forge/`
prefix; the catalogs are the register that keeps each rule id tied to the design-corpus file that
justifies it.

```ts
import { MODERN_CSS_RULES, RULE_CORPUS_PATH, RULE_ENFORCER } from "@y-core/forge/tooling/lint";
```

> **A leaf namespace.** It imports nothing from another forge namespace. The plugin is loaded by
> oxlint, and the catalogs are plain data — neither belongs in a Worker or a client bundle, but
> nothing here reaches for a Node built-in either.

> Every rule id, its permanence, and the three-way boundary between the corpus, this register and
> the gate are owned by
> [`UI_DESIGN_GUIDANCE.md`](../../../.decisions/implementation/UI_DESIGN_GUIDANCE.md) §3.

---

## Features

- **Twenty-three oxlint rules** under the `forge/` prefix, read off the AST rather than line by line:
  a class list bound to a module-scope const and passed by name is judged like an inline literal, and
  a markup rule reads a tag, an attribute or an ancestor chain off `JSXOpeningElement` rather than
  guessing at one with a regular expression.
- **Loaded by subpath** — naming `@y-core/forge/tooling/lint` in `jsPlugins` is the whole
  installation. The barrel exports the plugin as both `lintPlugin` and the default export, because
  oxlint reads the default.
- **A corpus register** — `RULE_CORPUS_PATH` names the design-corpus file behind every rule id, and
  `RULE_ENFORCER` names which mechanism enforces it. `validate-design` fails when the register and
  `.oxlintrc.json` disagree, so a rule cannot drift away from the document that states it.
- **A platform-CSS catalog** — `MODERN_CSS_RULES` carries each rule's tier, severity, corpus file,
  the platform feature that replaces the pattern, and what a human must verify before taking it.
- **Generated scale data** — the colour and spacing rules read `src/tooling/lint/data/design-scale.ts`,
  which the gate's `validate-design-scale` step regenerates from the compiled stylesheet and fails on
  any drift.

---

## Usage

### Load the plugin

```jsonc
{
  "plugins": ["eslint", "typescript", "unicorn", "oxc", "import", "promise", "jsx-a11y"],
  "jsPlugins": ["@y-core/forge/tooling/lint"],
  "rules": {
    "forge/suppression-needs-reason": "error",
    "forge/a11y-aria-beside-data": "error",
    "forge/a11y-heading-size-by-class": "error",
    "forge/a11y-label-association": "error",
    "forge/a11y-live-politeness": "error",
    "forge/a11y-no-aria-readonly-on-button": "error",
    "forge/a11y-one-live-region": "error",
    "forge/color-theme-no-raw-utility": "error",
    "forge/color-token-only": "error",
    "forge/data-slot-before-spread": "error",
    "forge/focus-ring": "error",
    "forge/interaction-focus-visible": "error",
    "forge/no-inline-style": "error",
    "forge/no-nested-card": "error",
    "forge/platform-entry-motion": "error",
    "forge/platform-logical-spacing": "error",
    "forge/platform-text-balance": "error",
    "forge/platform-text-pretty": "error",
    "forge/reduced-motion": "error",
    "forge/spacing-scale-only": "error",
  },
}
```

The plugin declares `meta.name: "forge"`, which is where the `forge/` prefix comes from. Every rule
is **off until you name it** — the plugin registers them, your config enables them.

`forge/optional-prop-undefined` and `forge/catalog-wrong-raw-input` are deliberately absent above.
Each is local to a slice of the tree rather than universal — the first states a convention about
types a consumer constructs a value of, the second is about a showcase — so forge scopes them with
an override rather than turning them on everywhere:

```jsonc
{ "overrides": [{ "files": ["src/ui/core/*.tsx"], "rules": { "forge/optional-prop-undefined": "error" } }] }
```

Inside forge itself the same plugin is loaded from its relative path, `./src/tooling/lint/mod.ts`,
because forge has no copy of itself under `node_modules`.

### Cite a rule from the corpus

The two catalogs answer "which file states this rule, and what enforces it?" without opening either
side:

```ts
import { corpusIdOf, lintKeyOf, RULE_CORPUS_PATH, RULE_ENFORCER } from "@y-core/forge/tooling/lint";

RULE_CORPUS_PATH["forge-ui-color-token-only"]; // "src/ui/design/floor.md"
RULE_ENFORCER["forge-ui-color-token-only"]; // "lint"

lintKeyOf("forge-ui-color-token-only"); // "color-token-only" — the oxlint rule key
corpusIdOf("color-token-only"); // "forge-ui-color-token-only" | undefined
```

The `forge-ui-` prefix is the whole of the mapping: a corpus id minus its prefix is the plugin rule
key, and the register is what makes the round trip total rather than a naming convention nobody
checks.

### Read a platform-CSS rule

```ts
import { modernCssRule, MODERN_CSS_RULES } from "@y-core/forge/tooling/lint";

const rule = modernCssRule("forge-ui-platform-aspect-ratio");
rule.tier; // "A" — textual detection
rule.severity; // "fail"
rule.replacement; // "aspect-ratio"
rule.verify; // what a human confirms before taking the replacement
```

`modernCssRule` resolves an id from either catalog, so a finding reported under a corpus-owned id
resolves the same way one minted here does.

---

## Core Components & APIs

### The plugin

| Export       | Type         | Purpose                                                          |
| ------------ | ------------ | ---------------------------------------------------------------- |
| `lintPlugin` | `LintPlugin` | forge's rules, as oxlint loads them. `meta.name` is `"forge"`.   |
| `default`    | `LintPlugin` | The same object — oxlint reads a plugin module's default export. |

The twenty-three rules it registers:

| Rule key                          | Corpus id                                  | Judges                                                                    |
| --------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| `a11y-aria-beside-data`           | `forge-ui-a11y-aria-beside-data`           | A `data-*` state hook written by hand rather than through `stateAttrs`    |
| `a11y-heading-size-by-class`      | `forge-ui-a11y-heading-size-by-class`      | A heading whose level is chosen for its size rather than for the outline  |
| `a11y-label-association`          | `forge-ui-a11y-label-association`          | A `<label>` with neither a `for` nor a wrapped control                    |
| `a11y-live-politeness`            | `forge-ui-a11y-live-politeness`            | An `aria-live` that is not `polite`, or an unexplained `assertive`        |
| `a11y-no-aria-readonly-on-button` | `forge-ui-a11y-no-aria-readonly-on-button` | `aria-readonly` on a role that supports no such state                     |
| `a11y-one-live-region`            | `forge-ui-a11y-one-live-region`            | A live region opened beside the page's one announcer                      |
| `catalog-wrong-raw-input`         | `forge-ui-catalog-wrong-raw-input`         | A raw control where the showcase should render the component              |
| `color-theme-no-raw-utility`      | `forge-ui-color-theme-no-raw-utility`      | A raw palette utility with no `dark:` counterpart in the same class list  |
| `color-token-only`                | `forge-ui-color-token-only`                | A colour utility naming a raw palette value instead of a theme token      |
| `data-slot-before-spread`         | — none                                     | A literal `data-slot` written before a bare-identifier spread clobbers it |
| `exact-markup-assertion`          | — none                                     | `toContain`, `toMatch` or `.includes` on markup a render produced         |
| `focus-ring`                      | `forge-ui-focus-ring`                      | An outline suppressed on a pointer target with no `focus-visible:` ring   |
| `interaction-focus-visible`       | `forge-ui-interaction-focus-visible`       | A bare `focus:` variant, which paints on a pointer press too              |
| `no-inline-style`                 | `forge-ui-no-inline-style`                 | An inline `style=` attribute, which the renderer drops                    |
| `no-nested-card`                  | `forge-ui-no-nested-card`                  | A `<Card>` opened inside a `<Card.Content>`                               |
| `optional-prop-undefined`         | `forge-ui-optional-prop-undefined`         | An optional prop on a consumer-constructed type declared without `\       |
| `platform-entry-motion`           | `forge-ui-platform-entry-motion`           | Hand-written entry animation the platform now expresses                   |
| `platform-logical-spacing`        | `forge-ui-platform-logical-spacing`        | Physical spacing utilities where the logical pair is available            |
| `platform-text-balance`           | `forge-ui-platform-text-balance`           | Manual line balancing in place of `text-wrap: balance`                    |
| `platform-text-pretty`            | `forge-ui-platform-text-pretty`            | Orphan control in place of `text-wrap: pretty`                            |
| `reduced-motion`                  | `forge-ui-reduced-motion`                  | Motion with no `prefers-reduced-motion` escape                            |
| `spacing-scale-only`              | `forge-ui-spacing-scale-only`              | A spacing value off the design scale                                      |
| `suppression-needs-reason`        | — none                                     | An `oxlint-disable*` comment that gives no reason                         |

`data-slot-before-spread`, `exact-markup-assertion` and `suppression-needs-reason` state no design
rule, so the register names none of them. The first is the ordering half of the JSX contract, moved
off `validate-jsx`'s tag-frame scanner — the pragma half stays in the gate, where a file-presence
check belongs. The second is [`TESTING.md`](../../../.decisions/implementation/TESTING.md) §3e's
rule, scoped by an `overrides` entry to `src/ui`'s test files rather than turned on everywhere.

`suppression-needs-reason` is AST-anchored and covers every rule rather than only the design ones: `oxlint --type-aware` already
fails a _stale_ suppression, and this states the other half — a live one says why it is one.

`color-token-only` and `spacing-scale-only` read their vocabularies from
`src/tooling/lint/data/design-scale.ts`, a generated file. Regenerate it through the gate's
`validate-design-scale` step rather than editing it.

### The design-rule register

| Export             | Type                                     | Purpose                                                                       |
| ------------------ | ---------------------------------------- | ----------------------------------------------------------------------------- |
| `RuleId`           | union of 17 string literals              | Every rule the corpus states and this tooling enforces.                       |
| `RULE_CORPUS_PATH` | `Readonly<Record<RuleId, string>>`       | The corpus file that justifies each rule.                                     |
| `RuleEnforcer`     | `"gate" \| "lint" \| "contrast"`         | Which mechanism enforces a rule.                                              |
| `RULE_ENFORCER`    | `Readonly<Record<RuleId, RuleEnforcer>>` | The mechanism for each rule.                                                  |
| `lintKeyOf`        | `(id: string) => string`                 | The plugin rule key a corpus id is enforced under — the id minus `forge-ui-`. |
| `corpusIdOf`       | `(key: string) => RuleId \| undefined`   | The corpus id a plugin rule key belongs to, or `undefined`.                   |

`RULE_ENFORCER` is what keeps a `RULE_CORPUS_PATH` row from asserting nothing once its detector has
moved: `checkDesign` reads the enforcer to decide which side it holds the row against. A `gate` rule
is held against the gate's own source detectors, a `lint` rule against `.oxlintrc.json`, and
`contrast` against the measured colour pairs — that one reads no source at all.

### The platform-CSS catalog

| Export                   | Type                                                    | Purpose                                                        |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------------------------- |
| `ModernCssRuleId`        | union of 40 string literals                             | Every rule this catalog mints.                                 |
| `ModernCssCitedRuleId`   | `"forge-ui-interaction-focus-visible"`                  | Ids the design corpus already owns, cited rather than minted.  |
| `ModernCssReportedId`    | `ModernCssRuleId \| ModernCssCitedRuleId`               | Any id a finding may be reported under.                        |
| `ModernCssTier`          | `"A" \| "B" \| "C"`                                     | `A` is textual detection; `B` and `C` need rendered behaviour. |
| `ModernCssRule`          | see below                                               | What the check knows about one rule beyond detecting it.       |
| `MODERN_CSS_RULES`       | `Readonly<Record<ModernCssRuleId, ModernCssRule>>`      | Every minted rule, keyed by id.                                |
| `MODERN_CSS_CITED_RULES` | `Readonly<Record<ModernCssCitedRuleId, ModernCssRule>>` | Every cited rule, keyed by id.                                 |
| `modernCssRule`          | `(id: ModernCssReportedId) => ModernCssRule`            | The rule behind any reported id, from either catalog.          |

`ModernCssRule`:

| Field         | Type               | Description                                                               |
| ------------- | ------------------ | ------------------------------------------------------------------------- |
| `tier`        | `ModernCssTier`    | How the rule is detected.                                                 |
| `severity`    | `"fail" \| "warn"` | `fail` blocks the gate; `warn` survives a passing step.                   |
| `corpus`      | `string`           | The corpus file that states the rule.                                     |
| `replacement` | `string`           | The platform feature that replaces the pattern.                           |
| `verify`      | `string`           | What has to be confirmed by hand before taking the replacement.           |
| `enforcer`    | `RuleEnforcer?`    | Absent means `"gate"` — a detector in the check. Four rules are `"lint"`. |

A pattern the design corpus already names is reported under **the id it already has**, never under a
second one minted here — a rule id is permanent and corpus-unique, which is what makes a suppression
comment citing one stay meaningful. The four rules carrying `enforcer: "lint"` are
`forge-ui-platform-logical-spacing`, `forge-ui-platform-entry-motion`,
`forge-ui-platform-text-balance` and `forge-ui-platform-text-pretty` — the ones this plugin catches
in source, rather than the gate catching them in a stylesheet.

---

## See also

- [`@y-core/forge/tooling/gate`](../gate/README.md) — `validate-design`, `validate-modern-css` and
  `validate-design-scale`, the three steps that read these catalogs.
- [`UI_DESIGN_GUIDANCE.md`](../../../.decisions/implementation/UI_DESIGN_GUIDANCE.md) §3, §4 and §5
  — the stable rule-id scheme, the anti-drift gate contract, and where a new design rule is written.
