// Generated from src/tooling/lint/mod.ts by `bun run gen:lint-plugin` — do not edit.

// src/tooling/lint/design-rules.ts
var RULE_CORPUS_PATH = {
  "forge-ui-color-token-only": "src/ui/design/floor.md",
  "forge-ui-color-theme-no-raw-utility": "src/ui/design/reference/04-color.md",
  "forge-ui-no-inline-style": "src/ui/design/floor.md",
  "forge-ui-spacing-scale-only": "src/ui/design/floor.md",
  "forge-ui-no-nested-card": "src/ui/design/floor.md",
  "forge-ui-interaction-focus-visible": "src/ui/design/reference/09-interaction.md",
  "forge-ui-catalog-wrong-raw-input": "src/ui/design/catalog.md",
  "forge-ui-contrast-floor": "src/ui/design/floor.md",
  "forge-ui-a11y-label-association": "src/ui/design/floor.md",
  "forge-ui-a11y-live-politeness": "src/ui/design/reference/10-accessibility.md",
  "forge-ui-a11y-no-aria-readonly-on-button": "src/ui/design/reference/10-accessibility.md",
  "forge-ui-a11y-one-live-region": "src/ui/design/reference/10-accessibility.md",
  "forge-ui-a11y-aria-beside-data": "src/ui/design/reference/10-accessibility.md",
  "forge-ui-a11y-heading-size-by-class": "src/ui/design/reference/10-accessibility.md",
  "forge-ui-reduced-motion": "src/ui/design/floor.md",
  "forge-ui-focus-ring": "src/ui/design/floor.md",
  "forge-ui-optional-prop-undefined": "src/ui/design/reference/10-accessibility.md"
};
var RULE_ENFORCER = {
  "forge-ui-color-token-only": "lint",
  "forge-ui-color-theme-no-raw-utility": "lint",
  "forge-ui-no-inline-style": "lint",
  "forge-ui-spacing-scale-only": "lint",
  "forge-ui-no-nested-card": "lint",
  "forge-ui-interaction-focus-visible": "lint",
  "forge-ui-catalog-wrong-raw-input": "lint",
  "forge-ui-contrast-floor": "contrast",
  "forge-ui-a11y-label-association": "lint",
  "forge-ui-a11y-live-politeness": "lint",
  "forge-ui-a11y-no-aria-readonly-on-button": "lint",
  "forge-ui-a11y-one-live-region": "lint",
  "forge-ui-a11y-aria-beside-data": "lint",
  "forge-ui-a11y-heading-size-by-class": "lint",
  "forge-ui-reduced-motion": "lint",
  "forge-ui-focus-ring": "lint",
  "forge-ui-optional-prop-undefined": "lint"
};
var PREFIX = "forge-ui-";
function lintKeyOf(id) {
  return id.slice(PREFIX.length);
}
function corpusIdOf(key) {
  const id = `${PREFIX}${key}`;
  return id in RULE_CORPUS_PATH ? id : void 0;
}

// src/tooling/lint/modern-css-rules.ts
var CORPUS = "src/ui/design/reference/16-platform.md";
var MODERN_CSS_RULES = {
  "forge-ui-platform-aspect-ratio": {
    tier: "A",
    severity: "fail",
    corpus: CORPUS,
    replacement: "aspect-ratio",
    verify: "the percentage resolves against the inline size, so a ratio taken from a block-size padding is not the same box"
  },
  "forge-ui-platform-centering": {
    tier: "A",
    severity: "fail",
    corpus: CORPUS,
    replacement: "place-items: center",
    verify: "the replacement moves the rule onto the container, so a child positioned against a different containing block changes box"
  },
  "forge-ui-platform-image-set": {
    tier: "A",
    severity: "fail",
    corpus: CORPUS,
    replacement: "image-set()",
    verify: "a density query may also be switching art direction, which image-set() does not express"
  },
  "forge-ui-platform-isolation": {
    tier: "A",
    severity: "fail",
    corpus: CORPUS,
    replacement: "isolation: isolate",
    verify: "the negative layer may be deliberately painting behind an ancestor's background rather than behind a sibling"
  },
  "forge-ui-platform-light-dark": {
    tier: "A",
    severity: "fail",
    corpus: CORPUS,
    replacement: "light-dark()",
    verify: "light-dark() reads color-scheme, so the element must sit under a declared scheme rather than the media query's"
  },
  "forge-ui-platform-line-clamp": {
    tier: "A",
    severity: "fail",
    corpus: CORPUS,
    replacement: "line-clamp",
    verify: "the prefixed form needs display: -webkit-box, which the standard property does not, so the box type changes with it"
  },
  "forge-ui-platform-logical-spacing": {
    tier: "A",
    severity: "fail",
    corpus: CORPUS,
    replacement: "the logical property or utility on the same axis",
    verify: "a rule that is physical on purpose \u2014 anchored placement, a mirrored glyph \u2014 states so rather than being rewritten",
    enforcer: "lint"
  },
  "forge-ui-platform-scrollbar": {
    tier: "A",
    severity: "fail",
    corpus: CORPUS,
    replacement: "scrollbar-color and scrollbar-width",
    verify: "the standard properties style the scrollbar but cannot size or shape its parts the way the pseudo-elements did"
  },
  "forge-ui-platform-native-dialog": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "<dialog> opened with showModal()",
    verify: "showModal() puts the element in the top layer and makes the rest of the page inert, which a positioned div was not doing"
  },
  "forge-ui-platform-native-popover": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "the Popover API",
    verify: "a popover light-dismisses on outside click and Escape, so a panel that must survive either one is not one"
  },
  "forge-ui-platform-native-details": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "<details> and <summary>",
    verify: "a closed <details> hides its content from find-in-page only until the browser expands it, which changes what a scripted panel guaranteed"
  },
  "forge-ui-platform-entry-motion": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "@starting-style with transition-behavior: allow-discrete",
    verify: "the starting style applies on the first style change after insertion, so an element already in the DOM never enters",
    enforcer: "lint"
  },
  "forge-ui-platform-parent-state": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: ":has()",
    verify: ":has() re-evaluates on every state change, so a class the script only set once becomes live"
  },
  "forge-ui-platform-inert": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "the inert attribute",
    verify: "inert removes the subtree from the accessibility tree as well as from the tab order, which a tabindex sweep did not"
  },
  "forge-ui-platform-theme-detection": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "light-dark()",
    verify: "light-dark() follows color-scheme, so a theme the app drives from a class rather than the media query needs the script"
  },
  "forge-ui-platform-smooth-scroll": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "scroll-behavior with scroll-margin",
    verify: "scroll-behavior is honoured for user-initiated scrolls too, which a per-call option was not"
  },
  "forge-ui-platform-ticker": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "keyframes gated on prefers-reduced-motion",
    verify: "keyframes run off the main thread and cannot read a value the interval was recomputing each tick"
  },
  "forge-ui-platform-counters": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "CSS counters",
    verify: "generated content is not in the DOM, so a number that has to be copied or read by a script stays in text"
  },
  "forge-ui-platform-count-up": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "@property with counters",
    verify: "a registered custom property interpolates as a number but renders through content, which no assistive technology announces mid-animation"
  },
  "forge-ui-platform-animated-border": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "@property with conic-gradient()",
    verify: "registering the angle makes it animatable, and the gradient then repaints without a frame callback"
  },
  "forge-ui-platform-motion-path": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "offset-path",
    verify: "offset-path also rotates the element along the path unless offset-rotate says otherwise"
  },
  "forge-ui-platform-reveal-mask": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "a CSS mask driven by one custom property",
    verify: "a mask composites the whole element, so a child that was outside the scripted clip is now masked too"
  },
  "forge-ui-platform-scroll-reveal": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "animation-timeline: view()",
    verify: "a view timeline re-runs as the element scrolls back out, where a one-shot observer did not"
  },
  "forge-ui-platform-carousel": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "scroll snap with ::scroll-button()",
    verify: "scroll snap steps by snap position rather than by index, so a track with uneven slides pages differently"
  },
  "forge-ui-platform-field-sizing": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "field-sizing: content",
    verify: "the control now grows without bound unless a max-block-size caps it, which the scripted height implicitly did"
  },
  "forge-ui-platform-anchor-positioning": {
    tier: "B",
    severity: "warn",
    corpus: CORPUS,
    replacement: "anchor()",
    verify: "anchor() needs the anchor and the positioned element in the same anchor scope, which a measured rectangle did not require"
  },
  "forge-ui-platform-layer": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "@layer",
    verify: "an unlayered rule beats every layered one, so moving only part of a stylesheet into a layer inverts the order it had"
  },
  "forge-ui-platform-nesting": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "native CSS nesting",
    verify: "native nesting resolves a bare element selector differently from the preprocessor, which needed no & before a type"
  },
  "forge-ui-platform-container-query": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "@container",
    verify: "a container query needs an ancestor declaring container-type, which establishes containment and can change that ancestor's own sizing"
  },
  "forge-ui-platform-subgrid": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "subgrid",
    verify: "subgrid inherits the parent's tracks, so a child that was sized independently now stretches to the parent's"
  },
  "forge-ui-platform-selector-list": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: ":is() or :where()",
    verify: ":is() takes the specificity of its most specific argument and :where() takes none, so neither matches the list's own specificity"
  },
  "forge-ui-platform-accent-color": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "accent-color",
    verify: "accent-color tints the native control and cannot change its shape, so a design that redrew the box is not expressible"
  },
  "forge-ui-platform-view-transition": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "startViewTransition()",
    verify: "a view transition freezes the page for the capture, so work started in the callback delays the frame"
  },
  "forge-ui-platform-text-balance": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "text-wrap: balance",
    verify: "balancing is capped at a few lines, so it silently does nothing on a heading that wraps past the limit",
    enforcer: "lint"
  },
  "forge-ui-platform-text-pretty": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "text-wrap: pretty",
    verify: "pretty wrapping changes line breaks, so a block whose height was measured for a fixed box may now take another line",
    enforcer: "lint"
  },
  "forge-ui-platform-field-sizing-adopt": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "field-sizing: content",
    verify: "the control grows without bound unless a max-block-size caps it, and the rows attribute stops being the height"
  },
  "forge-ui-platform-interpolate-size": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "interpolate-size: allow-keywords",
    verify: "the keyword is allowed from the declaring element down, so a transition on an ancestor's descendant needs it declared above both"
  },
  "forge-ui-platform-scope": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "@scope",
    verify: "a scoped rule stops at the scope's lower boundary, so a descendant the prefix used to reach through a slot is no longer matched"
  },
  "forge-ui-platform-display-contents": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "display: contents",
    verify: "the box disappears with its background, border and any transform, and until recently took its accessibility role with it"
  },
  "forge-ui-platform-color-mix": {
    tier: "C",
    severity: "warn",
    corpus: CORPUS,
    replacement: "color-mix()",
    verify: "a mix with transparent composites against whatever is behind it, so a derived token carrying a contrast floor is not one"
  }
};
var MODERN_CSS_CITED_RULES = {
  "forge-ui-interaction-focus-visible": {
    tier: "C",
    severity: "warn",
    corpus: "src/ui/design/reference/09-interaction.md",
    replacement: ":focus-visible",
    verify: "a control reachable only by pointer never matches :focus-visible, so it would lose its indicator entirely"
  }
};
var REPORTED = { ...MODERN_CSS_RULES, ...MODERN_CSS_CITED_RULES };
function modernCssRule(id) {
  return REPORTED[id];
}

// src/tooling/lint/report.ts
var corpusPathOf = (id) => id in RULE_CORPUS_PATH ? RULE_CORPUS_PATH[id] : MODERN_CSS_RULES[id].corpus;
function reporter(context, corpusId) {
  return (detail, loc) => {
    context.report({ message: `${detail} (${corpusId} \u2014 ${corpusPathOf(corpusId)})`, loc });
  };
}

// src/tooling/lint/rules/a11y-aria-beside-data.ts
var PRESENCE_STATES = ["pressed", "checked", "selected", "disabled", "invalid", "busy"];
var PRESENCE_ATTRS = new Set(PRESENCE_STATES.map((state) => `data-${state}`));
var a11yAriaBesideData = {
  meta: {
    type: "problem",
    docs: { description: "A state hook is emitted through `stateAttrs`, so its `aria-*` counterpart is never written alone." }
  },
  create(context) {
    const report = reporter(context, "forge-ui-a11y-aria-beside-data");
    return {
      JSXAttribute(node) {
        const name = node.name?.name ?? "";
        if (!PRESENCE_ATTRS.has(name)) return;
        report(
          `hand-written \`${name}\` \u2014 emit it through \`stateAttrs\`, beside its \`aria-${name.slice("data-".length)}\` counterpart`,
          node.loc
        );
      }
    };
  }
};

// src/tooling/lint/ast.ts
var CLASS_ATTRIBUTES = /* @__PURE__ */ new Set(["class", "className"]);
var CLASS_CALLEES = /* @__PURE__ */ new Set(["cn", "cva"]);
function keyName(key) {
  if (key === void 0) return "";
  return key.name ?? (typeof key.value === "string" ? key.value : "");
}
function isClassPosition(node) {
  if (node.type === "JSXAttribute") return CLASS_ATTRIBUTES.has(node.name?.name ?? "");
  if (node.type === "Property") return CLASS_ATTRIBUTES.has(keyName(node.key));
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  return callee?.type === "Identifier" && CLASS_CALLEES.has(callee.name);
}
function enclosingClassPosition(node) {
  let found;
  for (let current = node.parent ?? void 0; current !== void 0; current = current.parent ?? void 0) {
    if (isClassPosition(current)) found = current;
  }
  return found;
}
function childrenOf(node) {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || value === null || typeof value !== "object") continue;
    for (const candidate of Array.isArray(value) ? value : [value]) {
      if (typeof candidate?.type === "string") out.push(candidate);
    }
  }
  return out;
}
function statedText(node, out = []) {
  if (node.type === "Literal") {
    const value = node.value;
    if (typeof value === "string") out.push(value);
    return out;
  }
  if (node.type === "TemplateLiteral") {
    for (const quasi of node.quasis) out.push(quasi.value.cooked ?? quasi.value.raw);
    return out;
  }
  for (const child of childrenOf(node)) statedText(child, out);
  return out;
}
function isModuleScope(declarator) {
  const declaration = declarator.parent ?? void 0;
  if (declaration?.type !== "VariableDeclaration") return false;
  const holder = declaration.parent ?? void 0;
  return holder?.type === "Program" || holder?.type === "ExportNamedDeclaration" && holder.parent?.type === "Program";
}
function literalVisitor(onPart) {
  const moduleConstants = /* @__PURE__ */ new Map();
  return {
    VariableDeclarator(node) {
      const declarator = node;
      const name = declarator.id?.type === "Identifier" ? declarator.id.name : void 0;
      if (name === void 0 || declarator.init == null || !isModuleScope(node)) return;
      moduleConstants.set(name, declarator.init);
    },
    Identifier(node) {
      const init = moduleConstants.get(node.name);
      if (init === void 0) return;
      if (node.parent?.type === "CallExpression" && node.parent.callee === node) return;
      if (isClassPosition(init)) return;
      const position = enclosingClassPosition(node);
      if (position === void 0) return;
      for (const text of statedText(init)) onPart(position, { node, text, loc: node.loc });
    },
    Literal(node) {
      const value = node.value;
      if (typeof value !== "string") return;
      if (node.parent?.type === "Property" && node.parent.key === node) return;
      const position = enclosingClassPosition(node);
      if (position === void 0) return;
      onPart(position, { node, text: value, loc: node.loc });
    },
    TemplateLiteral(node) {
      const position = enclosingClassPosition(node);
      if (position === void 0) return;
      for (const quasi of node.quasis) {
        onPart(position, { node: quasi, text: quasi.value.cooked ?? quasi.value.raw, loc: quasi.loc });
      }
    }
  };
}
function classLiteralVisitor(onLiteral) {
  return literalVisitor((_position, part) => {
    onLiteral(part);
  });
}
function classExpressionVisitor(onExpression) {
  const buffered = /* @__PURE__ */ new Map();
  const flush = (node) => {
    const parts = buffered.get(node);
    if (parts === void 0) return;
    buffered.delete(node);
    const first = parts[0];
    if (first === void 0) return;
    onExpression({ node, text: parts.map((part) => part.text).join(" "), loc: first.loc });
  };
  const visitor = literalVisitor((position, part) => {
    const parts = buffered.get(position);
    if (parts === void 0) buffered.set(position, [part]);
    else parts.push(part);
  });
  return { ...visitor, "JSXAttribute:exit": flush, "CallExpression:exit": flush, "Property:exit": flush };
}

// src/tooling/lint/rules/a11y-heading-size-by-class.ts
var HEADING_TAG = /^h[1-6]$/;
var TEXT_SIZE = /(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/;
function headingTag(position) {
  if (position.type !== "JSXAttribute") return void 0;
  const element = position.parent ?? void 0;
  if (element?.type !== "JSXOpeningElement") return void 0;
  const name = element.name;
  return name.type === "JSXIdentifier" && HEADING_TAG.test(name.name) ? name.name : void 0;
}
var a11yHeadingSizeByClass = {
  meta: {
    type: "problem",
    docs: {
      description: "A heading's size comes from a `text-*` class, so its level can follow the section's position rather than the size wanted."
    }
  },
  create(context) {
    const report = reporter(context, "forge-ui-a11y-heading-size-by-class");
    return classExpressionVisitor((found) => {
      const tag = headingTag(found.node);
      if (tag === void 0 || TEXT_SIZE.test(found.text)) return;
      report(
        `\`<${tag}>\` takes its size from the tag \u2014 set the size with a \`text-*\` class and the level from the section's position`,
        found.loc
      );
    });
  }
};

// src/tooling/lint/jsx.ts
function tagName(node) {
  if (node === void 0) return "element";
  const name = node;
  if (typeof name.name === "string") return name.name;
  if (name.object !== void 0) return `${tagName(name.object)}.${tagName(name.property)}`;
  if (name.namespace !== void 0) return `${tagName(name.namespace)}:${tagName(name.name)}`;
  return "element";
}
var openingTag = (node) => tagName(node.name);
var attributesOf = (node) => node.attributes ?? [];
function attributeNamed(node, name) {
  for (const attribute of attributesOf(node)) {
    if (attribute.type === "JSXAttribute" && attribute.name?.name === name) return attribute;
  }
  return void 0;
}
function statedString(value) {
  if (value == null) return void 0;
  const inner = value.type === "JSXExpressionContainer" ? value.expression ?? void 0 : value;
  if (inner === void 0 || inner.type !== "Literal") return void 0;
  const stated = inner.value;
  return typeof stated === "string" ? stated : void 0;
}
function spreadName(node) {
  const argument = node.argument;
  return argument?.type === "Identifier" ? argument.name : void 0;
}
function enclosingElement(node) {
  return node.parent?.type === "JSXElement" ? node.parent : void 0;
}
function containsTag(node, matches) {
  const own = node.openingElement;
  return childrenOf(node).some((child) => child !== own && reachesTag(child, matches));
}
function reachesTag(node, matches) {
  if (node.type === "JSXOpeningElement" && matches(openingTag(node))) return true;
  return childrenOf(node).some((child) => reachesTag(child, matches));
}

// src/tooling/lint/rules/a11y-label-association.ts
var LABEL_CONTROLS = /* @__PURE__ */ new Set([
  "input",
  "select",
  "textarea",
  "button",
  "meter",
  "progress",
  "Input",
  "Select",
  "Textarea",
  "Switch",
  "Slider",
  "NumberField",
  "Toggle"
]);
var a11yLabelAssociation = {
  meta: { type: "problem", docs: { description: "A label names a control, by `for` or by wrapping it; otherwise it labels nothing." } },
  create(context) {
    const report = reporter(context, "forge-ui-a11y-label-association");
    return {
      JSXOpeningElement(node) {
        if (openingTag(node) !== "label") return;
        if (attributeNamed(node, "for") !== void 0 || attributeNamed(node, "htmlFor") !== void 0) return;
        const element = enclosingElement(node);
        if (element !== void 0 && containsTag(element, (tag) => LABEL_CONTROLS.has(tag))) return;
        report("`<label>` with neither a `for` nor a wrapped control \u2014 it labels nothing", node.loc);
      }
    };
  }
};

// src/tooling/lint/rules/a11y-live-politeness.ts
var a11yLivePoliteness = {
  meta: { type: "problem", docs: { description: "A live region announces politely unless it has stated why it interrupts the reader." } },
  create(context) {
    const report = reporter(context, "forge-ui-a11y-live-politeness");
    return {
      JSXOpeningElement(node) {
        const value = statedString(attributeNamed(node, "aria-live")?.value);
        if (value === void 0 || value === "polite") return;
        report(
          value === "assertive" ? '`aria-live="assertive"` interrupts the reader \u2014 state why in a suppression, or use `polite`' : `\`aria-live="${value}"\` is neither \`polite\` nor \`assertive\``,
          node.loc
        );
      }
    };
  }
};

// src/tooling/lint/rules/a11y-no-aria-readonly-on-button.ts
var a11yNoAriaReadonlyOnButton = {
  meta: { type: "problem", docs: { description: "The button role carries no readonly state, so the attribute states nothing a reader hears." } },
  create(context) {
    const report = reporter(context, "forge-ui-a11y-no-aria-readonly-on-button");
    return {
      JSXOpeningElement(node) {
        if (attributeNamed(node, "aria-readonly") === void 0) return;
        const tag = openingTag(node);
        if (tag !== "button" && tag !== "Button" && statedString(attributeNamed(node, "role")?.value) !== "button") return;
        report(
          `\`aria-readonly\` on \`<${tag}>\` \u2014 the button role does not support it; carry the state on the control the button acts on`,
          node.loc
        );
      }
    };
  }
};

// src/tooling/lint/rules/a11y-one-live-region.ts
var a11yOneLiveRegion = {
  meta: { type: "problem", docs: { description: "A page has one live region; a second one interleaves its announcements with the first." } },
  create(context) {
    const report = reporter(context, "forge-ui-a11y-one-live-region");
    return {
      JSXOpeningElement(node) {
        const value = statedString(attributeNamed(node, "aria-live")?.value);
        if (value === void 0 || value === "off") return;
        report(
          `\`aria-live="${value}"\` opens a second live region \u2014 route the announcement into \`Toast.Container\` or \`FlashContainer\``,
          node.loc
        );
      }
    };
  }
};

// src/tooling/lint/rules/catalog-wrong-raw-input.ts
var RAW_CONTROLS = /* @__PURE__ */ new Set(["select", "input", "textarea", "button"]);
var catalogWrongRawInput = {
  meta: { type: "problem", docs: { description: "The showcase renders the component the corpus points at, never the raw control it wraps." } },
  create(context) {
    const report = reporter(context, "forge-ui-catalog-wrong-raw-input");
    return {
      JSXOpeningElement(node) {
        const tag = openingTag(node);
        if (!RAW_CONTROLS.has(tag)) return;
        report(`raw \`<${tag}>\` in the showcase \u2014 render the \`ui/core\` component the corpus points at`, node.loc);
      }
    };
  }
};

// src/tooling/lint/rules/color-theme-no-raw-utility.ts
var PALETTE_HUES = "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone";
var COLOR_UTILITIES = "bg|text|border|ring|from|via|to|fill|stroke|divide|outline|decoration|accent|caret|placeholder|shadow";
var PALETTE_UTILITY = new RegExp(`(?<![\\w-])((?:[a-z][a-z0-9-]*:)*)(${COLOR_UTILITIES})-(${PALETTE_HUES})-(?:50|[1-9]00|950)(?![\\w-])`, "g");
var colorThemeNoRawUtility = {
  meta: { type: "problem", docs: { description: "A raw palette utility is paired with its `dark:` counterpart, or replaced by a theme token." } },
  create(context) {
    const report = reporter(context, "forge-ui-color-theme-no-raw-utility");
    return classExpressionVisitor((found) => {
      const paired = /* @__PURE__ */ new Set();
      const bare = /* @__PURE__ */ new Map();
      for (const match of found.text.matchAll(PALETTE_UTILITY)) {
        const family = `${match[2]}-${match[3]}`;
        if ((match[1] ?? "").split(":").includes("dark")) paired.add(family);
        else if (!bare.has(family)) bare.set(family, match[0]);
      }
      for (const [family, written] of bare) {
        if (paired.has(family)) continue;
        report(`\`${written}\` has no \`dark:${family}-*\` counterpart beside it \u2014 a raw palette utility survives the theme switch`, found.loc);
      }
    });
  }
};

// src/tooling/lint/data/design-scale.ts
var SPACING_UNIT = "0.25rem";
var SPACING_ROOTS = [
  "basis",
  "block",
  "border-spacing",
  "border-spacing-x",
  "border-spacing-y",
  "bottom",
  "gap",
  "gap-x",
  "gap-y",
  "h",
  "indent",
  "inline",
  "inset",
  "inset-be",
  "inset-bs",
  "inset-e",
  "inset-s",
  "inset-x",
  "inset-y",
  "leading",
  "left",
  "m",
  "mask-b-from",
  "mask-b-to",
  "mask-conic-from",
  "mask-conic-to",
  "mask-l-from",
  "mask-l-to",
  "mask-linear-from",
  "mask-linear-to",
  "mask-r-from",
  "mask-r-to",
  "mask-radial-from",
  "mask-radial-to",
  "mask-t-from",
  "mask-t-to",
  "mask-x-from",
  "mask-x-to",
  "mask-y-from",
  "mask-y-to",
  "max-block",
  "max-h",
  "max-inline",
  "max-w",
  "mb",
  "mbe",
  "mbs",
  "me",
  "min-block",
  "min-h",
  "min-inline",
  "min-w",
  "ml",
  "mr",
  "ms",
  "mt",
  "mx",
  "my",
  "p",
  "pb",
  "pbe",
  "pbs",
  "pe",
  "pl",
  "pr",
  "ps",
  "pt",
  "px",
  "py",
  "right",
  "scroll-m",
  "scroll-mb",
  "scroll-mbe",
  "scroll-mbs",
  "scroll-me",
  "scroll-ml",
  "scroll-mr",
  "scroll-ms",
  "scroll-mt",
  "scroll-mx",
  "scroll-my",
  "scroll-p",
  "scroll-pb",
  "scroll-pbe",
  "scroll-pbs",
  "scroll-pe",
  "scroll-pl",
  "scroll-pr",
  "scroll-ps",
  "scroll-pt",
  "scroll-px",
  "scroll-py",
  "size",
  "space-x",
  "space-y",
  "top",
  "translate",
  "translate-x",
  "translate-y",
  "translate-z",
  "w"
];
var SPACING_STEPS = [
  "0.5",
  "1",
  "1.5",
  "2",
  "2.5",
  "3",
  "3.5",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "14",
  "16",
  "20",
  "24",
  "28",
  "32",
  "36",
  "40",
  "44",
  "48",
  "52",
  "56",
  "60",
  "64",
  "72",
  "80",
  "96"
];
var COLOR_ROOTS = [
  "accent",
  "bg",
  "border",
  "border-b",
  "border-be",
  "border-bs",
  "border-e",
  "border-l",
  "border-r",
  "border-s",
  "border-t",
  "border-x",
  "border-y",
  "caret",
  "decoration",
  "divide",
  "drop-shadow",
  "fill",
  "from",
  "inset-ring",
  "inset-shadow",
  "mask-b-from",
  "mask-b-to",
  "mask-conic-from",
  "mask-conic-to",
  "mask-l-from",
  "mask-l-to",
  "mask-linear-from",
  "mask-linear-to",
  "mask-r-from",
  "mask-r-to",
  "mask-radial-from",
  "mask-radial-to",
  "mask-t-from",
  "mask-t-to",
  "mask-x-from",
  "mask-x-to",
  "mask-y-from",
  "mask-y-to",
  "outline",
  "placeholder",
  "ring",
  "ring-offset",
  "scrollbar-thumb",
  "scrollbar-track",
  "shadow",
  "stroke",
  "text",
  "text-shadow",
  "to",
  "via"
];
var COLOR_TOKENS = [
  "accent",
  "accent-foreground",
  "amber-100",
  "amber-200",
  "amber-300",
  "amber-400",
  "amber-50",
  "amber-500",
  "amber-600",
  "amber-700",
  "amber-800",
  "amber-900",
  "amber-950",
  "background",
  "black",
  "blue-100",
  "blue-200",
  "blue-300",
  "blue-400",
  "blue-50",
  "blue-500",
  "blue-600",
  "blue-700",
  "blue-800",
  "blue-900",
  "blue-950",
  "border",
  "card",
  "card-foreground",
  "cyan-100",
  "cyan-200",
  "cyan-300",
  "cyan-400",
  "cyan-50",
  "cyan-500",
  "cyan-600",
  "cyan-700",
  "cyan-800",
  "cyan-900",
  "cyan-950",
  "destructive",
  "destructive-foreground",
  "destructive-text",
  "emerald-100",
  "emerald-200",
  "emerald-300",
  "emerald-400",
  "emerald-50",
  "emerald-500",
  "emerald-600",
  "emerald-700",
  "emerald-800",
  "emerald-900",
  "emerald-950",
  "foreground",
  "fuchsia-100",
  "fuchsia-200",
  "fuchsia-300",
  "fuchsia-400",
  "fuchsia-50",
  "fuchsia-500",
  "fuchsia-600",
  "fuchsia-700",
  "fuchsia-800",
  "fuchsia-900",
  "fuchsia-950",
  "gray-100",
  "gray-200",
  "gray-300",
  "gray-400",
  "gray-50",
  "gray-500",
  "gray-600",
  "gray-700",
  "gray-800",
  "gray-900",
  "gray-950",
  "green-100",
  "green-200",
  "green-300",
  "green-400",
  "green-50",
  "green-500",
  "green-600",
  "green-700",
  "green-800",
  "green-900",
  "green-950",
  "indigo-100",
  "indigo-200",
  "indigo-300",
  "indigo-400",
  "indigo-50",
  "indigo-500",
  "indigo-600",
  "indigo-700",
  "indigo-800",
  "indigo-900",
  "indigo-950",
  "info",
  "info-foreground",
  "info-text",
  "input",
  "lime-100",
  "lime-200",
  "lime-300",
  "lime-400",
  "lime-50",
  "lime-500",
  "lime-600",
  "lime-700",
  "lime-800",
  "lime-900",
  "lime-950",
  "mauve-100",
  "mauve-200",
  "mauve-300",
  "mauve-400",
  "mauve-50",
  "mauve-500",
  "mauve-600",
  "mauve-700",
  "mauve-800",
  "mauve-900",
  "mauve-950",
  "mist-100",
  "mist-200",
  "mist-300",
  "mist-400",
  "mist-50",
  "mist-500",
  "mist-600",
  "mist-700",
  "mist-800",
  "mist-900",
  "mist-950",
  "muted",
  "muted-foreground",
  "neutral-100",
  "neutral-200",
  "neutral-300",
  "neutral-400",
  "neutral-50",
  "neutral-500",
  "neutral-600",
  "neutral-700",
  "neutral-800",
  "neutral-900",
  "neutral-950",
  "olive-100",
  "olive-200",
  "olive-300",
  "olive-400",
  "olive-50",
  "olive-500",
  "olive-600",
  "olive-700",
  "olive-800",
  "olive-900",
  "olive-950",
  "orange-100",
  "orange-200",
  "orange-300",
  "orange-400",
  "orange-50",
  "orange-500",
  "orange-600",
  "orange-700",
  "orange-800",
  "orange-900",
  "orange-950",
  "pink-100",
  "pink-200",
  "pink-300",
  "pink-400",
  "pink-50",
  "pink-500",
  "pink-600",
  "pink-700",
  "pink-800",
  "pink-900",
  "pink-950",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "primary-soft",
  "primary-soft-border",
  "primary-soft-foreground",
  "primary-text",
  "purple-100",
  "purple-200",
  "purple-300",
  "purple-400",
  "purple-50",
  "purple-500",
  "purple-600",
  "purple-700",
  "purple-800",
  "purple-900",
  "purple-950",
  "red-100",
  "red-200",
  "red-300",
  "red-400",
  "red-50",
  "red-500",
  "red-600",
  "red-700",
  "red-800",
  "red-900",
  "red-950",
  "ring",
  "rose-100",
  "rose-200",
  "rose-300",
  "rose-400",
  "rose-50",
  "rose-500",
  "rose-600",
  "rose-700",
  "rose-800",
  "rose-900",
  "rose-950",
  "secondary",
  "secondary-foreground",
  "sky-100",
  "sky-200",
  "sky-300",
  "sky-400",
  "sky-50",
  "sky-500",
  "sky-600",
  "sky-700",
  "sky-800",
  "sky-900",
  "sky-950",
  "slate-100",
  "slate-200",
  "slate-300",
  "slate-400",
  "slate-50",
  "slate-500",
  "slate-600",
  "slate-700",
  "slate-800",
  "slate-900",
  "slate-950",
  "status-danger-border",
  "status-danger-strong",
  "status-danger-strong-foreground",
  "status-danger-subtle",
  "status-danger-subtle-foreground",
  "status-info-border",
  "status-info-strong",
  "status-info-strong-foreground",
  "status-info-subtle",
  "status-info-subtle-foreground",
  "status-success-border",
  "status-success-strong",
  "status-success-strong-foreground",
  "status-success-subtle",
  "status-success-subtle-foreground",
  "status-warning-border",
  "status-warning-strong",
  "status-warning-strong-foreground",
  "status-warning-subtle",
  "status-warning-subtle-foreground",
  "stone-100",
  "stone-200",
  "stone-300",
  "stone-400",
  "stone-50",
  "stone-500",
  "stone-600",
  "stone-700",
  "stone-800",
  "stone-900",
  "stone-950",
  "success",
  "success-foreground",
  "success-text",
  "taupe-100",
  "taupe-200",
  "taupe-300",
  "taupe-400",
  "taupe-50",
  "taupe-500",
  "taupe-600",
  "taupe-700",
  "taupe-800",
  "taupe-900",
  "taupe-950",
  "teal-100",
  "teal-200",
  "teal-300",
  "teal-400",
  "teal-50",
  "teal-500",
  "teal-600",
  "teal-700",
  "teal-800",
  "teal-900",
  "teal-950",
  "track",
  "violet-100",
  "violet-200",
  "violet-300",
  "violet-400",
  "violet-50",
  "violet-500",
  "violet-600",
  "violet-700",
  "violet-800",
  "violet-900",
  "violet-950",
  "warning",
  "warning-foreground",
  "warning-text",
  "white",
  "yellow-100",
  "yellow-200",
  "yellow-300",
  "yellow-400",
  "yellow-50",
  "yellow-500",
  "yellow-600",
  "yellow-700",
  "yellow-800",
  "yellow-900",
  "yellow-950",
  "zinc-100",
  "zinc-200",
  "zinc-300",
  "zinc-400",
  "zinc-50",
  "zinc-500",
  "zinc-600",
  "zinc-700",
  "zinc-800",
  "zinc-900",
  "zinc-950"
];

// src/tooling/lint/rules/color-token-only.ts
var ROOTS = new Set(COLOR_ROOTS);
var TOKENS = new Set(COLOR_TOKENS);
var PALETTE_TOKEN = /^(?:black|white)$|-\d+$/;
var BARE_TOKENS = new Set(COLOR_TOKENS.filter((token) => !PALETTE_TOKEN.test(token)));
var SHADOW_ROOTS = /* @__PURE__ */ new Set(["shadow", "inset-shadow", "drop-shadow", "text-shadow"]);
var COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/g;
var DECLARED_PROPERTIES = /* @__PURE__ */ new Set(["--tone", "--tone-fg", "--tone-text", "--tone-soft", "--tone-soft-fg", "--tone-soft-border"]);
var CUSTOM_PROPERTY = /(?<![\w-])(?:[a-z][a-z0-9-]*:)*(-?[a-z][a-z0-9-]*)-[[(](--[a-z0-9-]+)[\])]/g;
var colorTokenOnly = {
  meta: {
    type: "problem",
    docs: { description: "A colour is resolved through a semantic token, so the theme \u2014 and every mode it has \u2014 decides what is painted." }
  },
  create(context) {
    const report = reporter(context, "forge-ui-color-token-only");
    return classLiteralVisitor((found) => {
      const literals = /* @__PURE__ */ new Set();
      for (const match of found.text.matchAll(COLOR_LITERAL)) literals.add(match[0]);
      for (const literal of literals) {
        report(`raw colour literal \`${literal}\` in a class string \u2014 resolve the colour through a semantic token`, found.loc);
      }
      const undeclared = /* @__PURE__ */ new Set();
      for (const match of found.text.matchAll(CUSTOM_PROPERTY)) {
        const root = (match[1] ?? "").replace(/^-/, "");
        const property = match[2] ?? "";
        if (!ROOTS.has(root) || SHADOW_ROOTS.has(root) || DECLARED_PROPERTIES.has(property)) continue;
        const declared = property.startsWith("--color-") ? TOKENS.has(property.slice("--color-".length)) : BARE_TOKENS.has(property.slice(2));
        if (declared) continue;
        undeclared.add(`${root}|${property}`);
      }
      for (const hit of undeclared) {
        const [root = "", property = ""] = hit.split("|");
        report(`\`${root}-(${property})\` names a property the theme declares no colour token for`, found.loc);
      }
    });
  }
};

// src/tooling/lint/rules/data-slot-before-spread.ts
var dataSlotBeforeSpread = {
  meta: {
    type: "problem",
    docs: { description: "A literal `data-slot` written before `{...rest}` loses to the spread, so the element ships the caller's token." }
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        let slot;
        for (const attribute of attributesOf(node)) {
          if (attribute.type === "JSXAttribute") {
            const jsx = attribute;
            if (slot !== void 0 || jsx.name?.name !== "data-slot") continue;
            const value = statedString(jsx.value);
            if (value !== void 0) slot = { value, loc: attribute.loc };
            continue;
          }
          if (attribute.type !== "JSXSpreadAttribute" || slot === void 0) continue;
          const spread = spreadName(attribute);
          if (spread === void 0) continue;
          context.report({
            message: `\`<${openingTag(node)}>\` has a literal \`data-slot='${slot.value}'\` before \`{...${spread}}\` \u2014 the spread wins and the token is lost; destructure \`"data-slot": inherited\` and write \`data-slot={slotToken("${slot.value}", inherited)}\``,
            loc: slot.loc
          });
          return;
        }
      }
    };
  }
};

// src/tooling/lint/rules/exact-markup-assertion.ts
var SEED_RENDERER = /^render(?:[A-Z]\w*)?$/;
var SUBSTRING_MATCHERS = /* @__PURE__ */ new Set(["toContain", "toMatch"]);
var LIST_METHODS = /* @__PURE__ */ new Set(["split", "map", "filter", "flatMap", "concat", "matchAll"]);
var nameOf = (node) => node?.type === "Identifier" ? node.name : void 0;
function memberName(node) {
  if (node?.type !== "MemberExpression" || node.computed === true) return void 0;
  return nameOf(node.property);
}
function unwrap(node) {
  if (node?.type === "AwaitExpression") return unwrap(node.argument);
  if (node?.type === "TSAsExpression" || node?.type === "TSNonNullExpression" || node?.type === "ChainExpression") {
    return unwrap(node.expression);
  }
  return node;
}
function isFunction(node) {
  return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression" || node?.type === "FunctionDeclaration";
}
function producesList(node, lists) {
  const value = unwrap(node);
  if (value == null) return false;
  if (value.type === "ArrayExpression") return true;
  if (value.type === "Identifier") return lists.has(value.name);
  if (value.type === "LogicalExpression" || value.type === "ConditionalExpression") {
    const branches = value.type === "LogicalExpression" ? ["left", "right"] : ["consequent", "alternate"];
    return branches.some((key) => producesList(value[key], lists));
  }
  if (value.type !== "CallExpression") return false;
  const callee = value.callee;
  const method = memberName(callee);
  if (method !== void 0 && LIST_METHODS.has(method)) return true;
  if (lists.has(nameOf(callee) ?? "")) return true;
  return method === "from" && nameOf(callee.object) === "Array";
}
function annotatesList(node) {
  if (node == null) return false;
  if (node.type === "TSArrayType" || node.type === "TSTupleType") return true;
  if (node.type === "TSTypeReference") {
    const name = nameOf(node.typeName);
    if (name === "Array" || name === "ReadonlyArray") return true;
    return name === "Promise" && childrenOf(node).some(annotatesList);
  }
  if (node.type === "TSTypeAnnotation" || node.type === "TSTypeOperator" || node.type === "TSUnionType") {
    return childrenOf(node).some(annotatesList);
  }
  return false;
}
var returnTypeOf = (node) => node.returnType;
function blockReturnsList(node, lists) {
  return childrenOf(node).some((child) => {
    if (isFunction(child)) return false;
    if (child.type === "ReturnStatement") return producesList(child.argument, lists);
    return blockReturnsList(child, lists);
  });
}
function yieldsList(node, lists) {
  const value = unwrap(node);
  if (value == null) return false;
  if (isFunction(value)) {
    const body = value.body;
    return annotatesList(returnTypeOf(value)) || yieldsList(body, lists);
  }
  if (value.type === "BlockStatement") return blockReturnsList(value, lists);
  return producesList(value, lists);
}
function assertsAbsence(node) {
  const asserted = node.parent;
  if (asserted?.type !== "CallExpression" || nameOf(asserted.callee) !== "expect") return false;
  const negated = memberName(asserted.parent) === "not";
  const matcher = negated ? asserted.parent?.parent : asserted.parent;
  if (memberName(matcher) !== "toBe") return false;
  const call = matcher?.parent;
  const argument = call?.type === "CallExpression" ? call.arguments[0] : void 0;
  const value = argument?.type === "Literal" ? argument.value : void 0;
  return value === negated;
}
function reachesMarkup(node, names) {
  if (node === void 0) return false;
  if (node.type === "CallExpression" && names.functions.has(nameOf(node.callee) ?? "")) return true;
  if (node.type === "Identifier" && names.values.has(node.name)) return true;
  return childrenOf(node).some((child) => reachesMarkup(child, names));
}
var exactMarkupAssertion = {
  meta: {
    type: "problem",
    docs: { description: "`toContain`, `toMatch` and `.includes` on rendered markup pass on markup that moved to the wrong element." }
  },
  create(context) {
    const names = { functions: /* @__PURE__ */ new Set(), values: /* @__PURE__ */ new Set() };
    const lists = /* @__PURE__ */ new Set();
    const bindings = [];
    const candidates = [];
    const addCandidate = (node) => {
      const callee = node.callee;
      const method = memberName(callee);
      if (method === void 0) return;
      const receiver = callee.object;
      if (method === "includes") {
        if (receiver !== void 0 && !assertsAbsence(node)) candidates.push({ subject: receiver, matcher: ".includes", loc: node.loc });
        return;
      }
      if (!SUBSTRING_MATCHERS.has(method)) return;
      if (memberName(receiver) === "not") return;
      if (receiver?.type !== "CallExpression" || nameOf(receiver.callee) !== "expect") return;
      const subject = receiver.arguments[0];
      if (subject !== void 0) candidates.push({ subject, matcher: method, loc: node.loc });
    };
    return {
      CallExpression(node) {
        const name = nameOf(node.callee);
        if (name !== void 0 && SEED_RENDERER.test(name)) names.functions.add(name);
        addCandidate(node);
      },
      VariableDeclarator(node) {
        const declarator = node;
        const name = nameOf(declarator.id);
        if (name === void 0 || declarator.init == null) return;
        bindings.push({ name, body: declarator.init, fn: isFunction(unwrap(declarator.init)) });
      },
      FunctionDeclaration(node) {
        const declared = node;
        const name = nameOf(declared.id);
        if (name !== void 0 && declared.body !== void 0) {
          bindings.push({ name, body: declared.body, fn: true, returnType: returnTypeOf(node) });
        }
      },
      "Program:exit"() {
        for (let size = -1; size !== names.functions.size + names.values.size + lists.size; ) {
          size = names.functions.size + names.values.size + lists.size;
          for (const binding of bindings) {
            if (annotatesList(binding.returnType) || yieldsList(binding.body, lists)) lists.add(binding.name);
            if (!reachesMarkup(binding.body, names)) continue;
            if (binding.fn) names.functions.add(binding.name);
            else if (!lists.has(binding.name)) names.values.add(binding.name);
          }
        }
        for (const { subject, matcher, loc } of candidates) {
          if (producesList(subject, lists) || !reachesMarkup(subject, names)) continue;
          context.report({
            message: `\`${matcher}\` on rendered markup \u2014 assert the exact string: a substring assertion passes on markup that moved, so the attribute may have landed on the wrong element. \`toBe\` the whole render, or extract the fragment and \`toBe\` that (TESTING.md \xA73b)`,
            loc
          });
        }
      }
    };
  }
};

// src/tooling/lint/rules/focus-ring.ts
var OUTLINE_SUPPRESSOR = /(?<![\w-])(outline-none|outline-hidden)(?![\w-])/;
var FOCUS_VISIBLE_RING = /focus-visible[^\s]*:ring(?:-(?!0(?![\w-])|offset)[\w-]+)?(?![\w-])|(?<![\w-])focus-ring(?:-outset)?(?![\w-])/;
var POINTER_TARGET = /(?<![\w-])cursor-pointer(?![\w-])/;
var focusRing = {
  meta: {
    type: "problem",
    docs: { description: "An outline a class list suppresses is replaced by a `focus-visible:` ring, not simply removed." }
  },
  create(context) {
    const report = reporter(context, "forge-ui-focus-ring");
    return classExpressionVisitor((found) => {
      if (!POINTER_TARGET.test(found.text)) return;
      const suppressor = OUTLINE_SUPPRESSOR.exec(found.text);
      if (suppressor === null || FOCUS_VISIBLE_RING.test(found.text)) return;
      report(
        `\`${suppressor[1]}\` on a pointer target with no \`focus-visible:ring-*\` beside it \u2014 the affordance is removed, not replaced`,
        found.loc
      );
    });
  }
};

// src/tooling/lint/rules/interaction-focus-visible.ts
var BARE_FOCUS = /(?<![\w-])focus:(?=[a-z[])[a-z0-9#%[\]/.-]+/g;
var interactionFocusVisible = {
  meta: {
    type: "problem",
    docs: { description: "Focus styling is written with `focus-visible:`, so a pointer press does not paint a focus ring." }
  },
  create(context) {
    const report = reporter(context, "forge-ui-interaction-focus-visible");
    return classLiteralVisitor((found) => {
      const hits = /* @__PURE__ */ new Set();
      for (const match of found.text.matchAll(BARE_FOCUS)) hits.add(match[0]);
      for (const hit of hits) report(`\`${hit}\` styles every focus including pointer focus \u2014 use \`focus-visible:\``, found.loc);
    });
  }
};

// src/tooling/lint/rules/no-inline-style.ts
var noInlineStyle = {
  meta: { type: "problem", docs: { description: "A visual rule is expressed as a class; the renderer drops an inline `style` attribute." } },
  create(context) {
    const report = reporter(context, "forge-ui-no-inline-style");
    return {
      JSXAttribute(node) {
        if (node.name?.name !== "style") return;
        report("`style=` attribute \u2014 the renderer drops it; express the rule as a class", node.loc);
      }
    };
  }
};

// src/tooling/lint/rules/no-nested-card.ts
var noNestedCard = {
  meta: { type: "problem", docs: { description: "A card is not nested inside another card's content, where the two borders compound." } },
  create(context) {
    const report = reporter(context, "forge-ui-no-nested-card");
    return {
      JSXOpeningElement(node) {
        if (openingTag(node) !== "Card.Content") return;
        const element = enclosingElement(node);
        if (element === void 0 || !containsTag(element, (tag) => tag === "Card")) return;
        report("`<Card>` nested inside `<Card.Content>` \u2014 the borders compound rather than nest", node.loc);
      }
    };
  }
};

// src/tooling/lint/rules/optional-prop-undefined.ts
function admitsUndefined(annotation) {
  if (annotation === void 0) return true;
  if (annotation.type === "TSUndefinedKeyword" || annotation.type === "TSAnyKeyword" || annotation.type === "TSUnknownKeyword") return true;
  if (annotation.type !== "TSUnionType") return false;
  return (annotation.types ?? []).some((member) => admitsUndefined(member));
}
var optionalPropUndefined = {
  meta: {
    type: "problem",
    docs: {
      description: "Under `exactOptionalPropertyTypes`, a bare `?:` forces a consumer into a guard-form spread that `jsx-a11y` cannot read."
    }
  },
  create(context) {
    const report = reporter(context, "forge-ui-optional-prop-undefined");
    return {
      TSPropertySignature(node) {
        const property = node;
        if (property.optional !== true) return;
        if (admitsUndefined(property.typeAnnotation?.typeAnnotation)) return;
        const name = property.key?.name ?? "this property";
        report(`\`${name}?:\` omits \`| undefined\` \u2014 a consumer must then spread it conditionally, which no a11y rule can see through`, node.loc);
      }
    };
  }
};

// src/tooling/lint/rules/platform-entry-motion.ts
var CLASS_LIST_METHODS = /* @__PURE__ */ new Set(["add", "remove", "toggle"]);
var nameOf2 = (node) => node?.type === "Identifier" || node?.type === "JSXIdentifier" ? node.name : void 0;
function isClassListCall(node) {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  if (callee.type !== "MemberExpression") return false;
  const method = nameOf2(callee.property);
  if (method === void 0 || !CLASS_LIST_METHODS.has(method)) return false;
  const owner = callee.object;
  return owner.type === "MemberExpression" && nameOf2(owner.property) === "classList";
}
function isFrameCall(node) {
  return node.type === "CallExpression" && nameOf2(node.callee) === "requestAnimationFrame";
}
var platformEntryMotion = {
  meta: {
    type: "problem",
    docs: { description: "An entry transition is declared with `@starting-style`, not started by adding a class on the next frame." }
  },
  create(context) {
    const report = reporter(context, "forge-ui-platform-entry-motion");
    const reported = /* @__PURE__ */ new Set();
    return {
      CallExpression(node) {
        if (!isClassListCall(node)) return;
        for (let current = node.parent ?? void 0; current !== void 0; current = current.parent ?? void 0) {
          if (!isFrameCall(current)) continue;
          if (reported.has(current)) return;
          reported.add(current);
          report(
            "a class added inside `requestAnimationFrame` to start an entry transition \u2014 declare it with `@starting-style` and `transition-behavior: allow-discrete`",
            node.loc
          );
          return;
        }
      }
    };
  }
};

// src/tooling/lint/rules/platform-logical-spacing.ts
var PHYSICAL_UTILITY = /(?<![\w-])(?:[a-z][a-z0-9-]*:)*-?(?:[mp][lr]-[a-z0-9./[\]()%-]+|(?:border|rounded)-[lr](?![a-z])[a-z0-9./[\]()%-]*|text-(?:left|right))(?![\w])/g;
var UTILITY_SWAP = [
  [/^ml-/, "ms-"],
  [/^mr-/, "me-"],
  [/^pl-/, "ps-"],
  [/^pr-/, "pe-"],
  [/^border-l\b/, "border-s"],
  [/^border-r\b/, "border-e"],
  [/^rounded-l\b/, "rounded-s"],
  [/^rounded-r\b/, "rounded-e"],
  [/^text-left$/, "text-start"],
  [/^text-right$/, "text-end"]
];
function logicalUtility(token) {
  const variants = token.slice(0, token.lastIndexOf(":") + 1);
  const signed = token.slice(variants.length);
  const sign = signed.startsWith("-") ? "-" : "";
  const base = signed.slice(sign.length);
  for (const [physical, logical] of UTILITY_SWAP) {
    if (physical.test(base)) return `${variants}${sign}${base.replace(physical, logical)}`;
  }
  return token;
}
var platformLogicalSpacing = {
  meta: {
    type: "problem",
    docs: { description: "Inline-axis spacing is written logically, so the layout mirrors with the writing mode instead of staying left-handed." }
  },
  create(context) {
    const report = reporter(context, "forge-ui-platform-logical-spacing");
    return classLiteralVisitor((found) => {
      const hits = /* @__PURE__ */ new Set();
      for (const match of found.text.matchAll(PHYSICAL_UTILITY)) hits.add(match[0]);
      for (const hit of hits) report(`physical utility \`${hit}\` \u2014 use \`${logicalUtility(hit)}\``, found.loc);
    });
  }
};

// src/tooling/lint/rules/platform-text-balance.ts
var HEADING_SIZE = /(?<![\w-])text-[2-9]xl(?![\w-])/;
var BALANCED = /(?<![\w-])text-balance(?![\w-])/;
var platformTextBalance = {
  meta: {
    type: "problem",
    docs: {
      description: "A display-sized heading balances its line breaks with `text-wrap: balance` rather than breaking wherever the width lands."
    }
  },
  create(context) {
    const report = reporter(context, "forge-ui-platform-text-balance");
    return classExpressionVisitor((found) => {
      const heading = HEADING_SIZE.exec(found.text);
      if (heading === null || BALANCED.test(found.text)) return;
      report(`\`${heading[0]}\` heading with no \`text-balance\` \u2014 balance the line breaks with \`text-wrap: balance\``, found.loc);
    });
  }
};

// src/tooling/lint/rules/platform-text-pretty.ts
var PROSE_CLASS = /(?<![\w-])(?:prose|max-w-prose|leading-relaxed)(?![\w-])/;
var PRETTY = /(?<![\w-])text-pretty(?![\w-])/;
var platformTextPretty = {
  meta: {
    type: "problem",
    docs: { description: "A run of prose avoids the orphan with `text-wrap: pretty` rather than leaving the last line to the browser." }
  },
  create(context) {
    const report = reporter(context, "forge-ui-platform-text-pretty");
    return classExpressionVisitor((found) => {
      const prose = PROSE_CLASS.exec(found.text);
      if (prose === null || PRETTY.test(found.text)) return;
      report(`\`${prose[0]}\` prose with no \`text-pretty\` \u2014 avoid the orphan with \`text-wrap: pretty\``, found.loc);
    });
  }
};

// src/tooling/lint/rules/reduced-motion.ts
var MOTION_BASE = /^(?:animate-|transition)/;
var SETTLED = /* @__PURE__ */ new Set(["animate-none", "transition-none"]);
var GATED = /(?<![\w-])motion-(?:safe|reduce):/;
var reducedMotion = {
  meta: {
    type: "problem",
    docs: { description: "Authored motion is written inside `motion-safe:`, with `motion-reduce:` given the settled state." }
  },
  create(context) {
    const report = reporter(context, "forge-ui-reduced-motion");
    return classExpressionVisitor((found) => {
      if (GATED.test(found.text)) return;
      const hits = /* @__PURE__ */ new Set();
      for (const token of found.text.split(/\s+/)) {
        const base = token.slice(token.lastIndexOf(":") + 1);
        if (MOTION_BASE.test(base) && !SETTLED.has(base)) hits.add(token);
      }
      for (const hit of hits) {
        report(
          `\`${hit}\` runs whatever the reader has asked for \u2014 author it inside \`motion-safe:\` and give \`motion-reduce:\` the settled state`,
          found.loc
        );
      }
    });
  }
};

// src/tooling/lint/rules/spacing-scale-only.ts
var ROOTS2 = new Set(SPACING_ROOTS);
var ARBITRARY = /(?<![\w-])(?:[a-z][a-z0-9-]*:)*(-?)([a-z][a-z0-9-]*)-\[([^\]\s]+)\]/g;
var LENGTH = /^(-?\d+(?:\.\d+)?)(px|rem)$/;
var PIXELS_PER_REM = 16;
var unitPx = (() => {
  const unit = LENGTH.exec(SPACING_UNIT);
  if (unit === null) return Number.NaN;
  return Number(unit[1]) * (unit[2] === "rem" ? PIXELS_PER_REM : 1);
})();
var STEPS = new Set(SPACING_STEPS);
function stepFor(value) {
  const length = LENGTH.exec(value);
  if (length === null || Number.isNaN(unitPx)) return void 0;
  const pixels = Number(length[1]) * (length[2] === "rem" ? PIXELS_PER_REM : 1);
  const multiple = Math.abs(pixels) / unitPx;
  return STEPS.has(String(multiple)) ? { step: String(multiple), negative: pixels < 0 } : void 0;
}
var spacingScaleOnly = {
  meta: {
    type: "problem",
    docs: { description: "Spacing comes from the scale the design system declares, so one edit to `--spacing` moves the whole layout." }
  },
  create(context) {
    const report = reporter(context, "forge-ui-spacing-scale-only");
    return classLiteralVisitor((found) => {
      const hits = /* @__PURE__ */ new Set();
      for (const match of found.text.matchAll(ARBITRARY)) {
        const [, sign = "", root = "", value = ""] = match;
        if (!ROOTS2.has(root)) continue;
        const matched = stepFor(value);
        if (matched === void 0) continue;
        const negative = sign === "-" !== matched.negative;
        hits.add(`${sign}${root}-[${value}]|${negative ? "-" : ""}${root}-${matched.step}`);
      }
      for (const hit of hits) {
        const [written = "", scale = ""] = hit.split("|");
        report(`arbitrary value \`${written}\` where the scale states \`${scale}\``, found.loc);
      }
    });
  }
};

// src/tooling/lint/rules/suppression-needs-reason.ts
var named = (directive) => directive.value === "" ? "every rule" : `\`${directive.value}\``;
var suppressionNeedsReason = {
  meta: {
    type: "problem",
    docs: { description: "Every `oxlint-disable` directive states why, so a suppression can be judged rather than only counted." }
  },
  create(context) {
    return {
      Program() {
        for (const directive of context.sourceCode.getDisableDirectives().directives) {
          if (directive.justification.trim() !== "") continue;
          context.report({
            message: `\`oxlint-${directive.type}\` for ${named(directive)} with no reason \u2014 append \` -- <why>\`, so the next reader can judge the suppression rather than only count it.`,
            node: directive.node
          });
        }
      }
    };
  }
};

// src/tooling/lint/plugin.ts
var lintPlugin = {
  meta: { name: "forge" },
  rules: {
    "a11y-aria-beside-data": a11yAriaBesideData,
    "a11y-heading-size-by-class": a11yHeadingSizeByClass,
    "a11y-label-association": a11yLabelAssociation,
    "a11y-live-politeness": a11yLivePoliteness,
    "a11y-no-aria-readonly-on-button": a11yNoAriaReadonlyOnButton,
    "a11y-one-live-region": a11yOneLiveRegion,
    "catalog-wrong-raw-input": catalogWrongRawInput,
    "color-theme-no-raw-utility": colorThemeNoRawUtility,
    "color-token-only": colorTokenOnly,
    "data-slot-before-spread": dataSlotBeforeSpread,
    "exact-markup-assertion": exactMarkupAssertion,
    "focus-ring": focusRing,
    "interaction-focus-visible": interactionFocusVisible,
    "no-inline-style": noInlineStyle,
    "no-nested-card": noNestedCard,
    "optional-prop-undefined": optionalPropUndefined,
    "platform-entry-motion": platformEntryMotion,
    "platform-logical-spacing": platformLogicalSpacing,
    "platform-text-balance": platformTextBalance,
    "platform-text-pretty": platformTextPretty,
    "reduced-motion": reducedMotion,
    "spacing-scale-only": spacingScaleOnly,
    "suppression-needs-reason": suppressionNeedsReason
  }
};
var plugin_default = lintPlugin;
export {
  MODERN_CSS_CITED_RULES,
  MODERN_CSS_RULES,
  RULE_CORPUS_PATH,
  RULE_ENFORCER,
  corpusIdOf,
  plugin_default as default,
  lintKeyOf,
  lintPlugin,
  modernCssRule
};
