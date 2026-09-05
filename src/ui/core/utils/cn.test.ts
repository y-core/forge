import { describe, expect, it } from "bun:test";

import { cn, utilityOf } from "./cn";

describe("cn", () => {
  it("joins multiple strings with a space", () => {
    expect(cn("foo", "bar", "baz")).toBe("foo bar baz");
  });

  it("returns an empty string when called with no arguments", () => {
    expect(cn()).toBe("");
  });

  it("filters out false values", () => {
    expect(cn("foo", false, "bar")).toBe("foo bar");
  });

  it("filters out null values", () => {
    expect(cn("foo", null, "bar")).toBe("foo bar");
  });

  it("filters out undefined values", () => {
    expect(cn("foo", undefined, "bar")).toBe("foo bar");
  });

  it("filters out empty strings", () => {
    expect(cn("foo", "", "bar")).toBe("foo bar");
  });

  it("returns an empty string when all values are falsy", () => {
    expect(cn(false, null, undefined, "")).toBe("");
  });

  it("returns a single class unchanged", () => {
    expect(cn("only")).toBe("only");
  });
});

describe("cn conflict resolution", () => {
  const cases: { input: [string, string]; expected: string; why: string }[] = [
    { input: ["h-full", "h-5"], expected: "h-5", why: "later utility in the same group wins" },
    { input: ["inline-flex", "flex"], expected: "flex", why: "display values share one group" },
    { input: ["h-full", "hover:h-5"], expected: "h-full hover:h-5", why: "a modifier scopes the group" },
    {
      input: ["h-full", "not-a-tailwind-class"],
      expected: "h-full not-a-tailwind-class",
      why: "an unrecognised utility is kept and consumes nothing",
    },
    { input: ["h-5", "h-[3px]"], expected: "h-[3px]", why: "an arbitrary value still occupies the group" },
    { input: ["bg-primary", "bg-primary/90"], expected: "bg-primary/90", why: "the value slash is not part of the group" },
    { input: ["ring-ring/20", "ring-ring"], expected: "ring-ring", why: "slash-stripping applies to the earlier token too" },
  ];

  for (const { input, expected, why } of cases) {
    it(`cn("${input[0]}", "${input[1]}") === "${expected}" — ${why}`, () => {
      expect(cn(input[0], input[1])).toBe(expected);
    });
  }

  it("lets a caller's height displace a base height inside a longer class string", () => {
    expect(cn("h-full w-px border-0 bg-border", "h-5")).toBe("w-px border-0 bg-border h-5");
  });

  it("keeps source order for non-conflicting utilities", () => {
    expect(cn("flex", "items-center", "gap-2")).toBe("flex items-center gap-2");
  });
});

describe("cn alignment and cursor groups", () => {
  const cases: { input: [string, string]; expected: string }[] = [
    { input: ["items-center", "items-baseline"], expected: "items-baseline" },
    { input: ["justify-center", "justify-between"], expected: "justify-between" },
    { input: ["cursor-default", "cursor-pointer"], expected: "cursor-pointer" },
  ];

  for (const { input, expected } of cases) {
    it(`cn("${input[0]}", "${input[1]}") === "${expected}"`, () => {
      expect(cn(input[0], input[1])).toBe(expected);
    });
  }

  it("lets a caller override a full layout triplet", () => {
    expect(cn("inline-flex items-center justify-center", "flex items-baseline justify-between")).toBe("flex items-baseline justify-between");
  });
});

describe("cn non-conflict regressions", () => {
  const cases: { input: [string, string]; expected: string; why: string }[] = [
    { input: ["text-xs", "text-blue-700"], expected: "text-xs text-blue-700", why: "font-size and text-color are separate" },
    { input: ["flex", "flex-col"], expected: "flex flex-col", why: "display and flex-direction are separate" },
    { input: ["flex", "flex-1"], expected: "flex flex-1", why: "display and flex grow/shrink are separate" },
    { input: ["flex-row", "flex-col"], expected: "flex-col", why: "flex-direction is one group" },
    { input: ["border", "border-input"], expected: "border border-input", why: "border width and border colour are separate" },
    { input: ["border-b", "border-b-0"], expected: "border-b-0", why: "per-side border width is one group" },
    { input: ["border-0", "border"], expected: "border", why: "the bare border utility is a width" },
    { input: ["select-none", "select-wrapper"], expected: "select-none select-wrapper", why: "user-select is a closed value space" },
    { input: ["text-muted-foreground", "text-pretty"], expected: "text-muted-foreground text-pretty", why: "text wrapping is not a colour" },
    { input: ["text-pretty", "text-balance"], expected: "text-balance", why: "text wrapping is one group" },
    { input: ["text-nowrap", "text-wrap"], expected: "text-wrap", why: "text wrapping is one group" },
    { input: ["font-sans", "font-stretch-normal"], expected: "font-sans font-stretch-normal", why: "font stretch is not a family" },
    { input: ["font-stretch-75%", "font-stretch-normal"], expected: "font-stretch-normal", why: "font stretch is one group" },
  ];

  for (const { input, expected, why } of cases) {
    it(`cn("${input[0]}", "${input[1]}") === "${expected}" — ${why}`, () => {
      expect(cn(input[0], input[1])).toBe(expected);
    });
  }

  it("keeps a size, a colour and a wrapping mode from one literal", () => {
    const literal = "text-sm text-muted-foreground text-pretty";

    expect(cn(literal)).toBe(literal);
  });

  it("keeps a group marker class alongside unrelated utilities", () => {
    expect(cn("group/select", "relative", "w-full")).toBe("group/select relative w-full");
  });
});

describe("cn modifier handling", () => {
  it("treats stacked modifiers as the same scope regardless of order", () => {
    expect(cn("dark:md:h-4", "md:dark:h-5")).toBe("md:dark:h-5");
  });

  it("keeps utilities under different single modifiers", () => {
    expect(cn("md:flex", "hover:flex")).toBe("md:flex hover:flex");
  });

  it("resolves a conflict within the same arbitrary-variant scope", () => {
    expect(cn("[&_svg]:size-5", "[&_svg]:size-6")).toBe("[&_svg]:size-6");
  });

  it("does not let an unscoped utility displace an arbitrary-variant one", () => {
    expect(cn("[&_svg]:size-5", "size-6")).toBe("[&_svg]:size-5 size-6");
  });

  it("round-trips the field.tsx child-slot selector byte-for-byte", () => {
    expect(cn("[&>[data-slot~=field-label]]:flex-auto")).toBe("[&>[data-slot~=field-label]]:flex-auto");
  });

  it("round-trips the switch.tsx sibling-state selector byte-for-byte", () => {
    expect(cn("[[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&]:translate-x-4")).toBe(
      "[[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&]:translate-x-4",
    );
  });
});

describe("cn arbitrary properties", () => {
  it("resolves two arbitrary declarations of the same property", () => {
    expect(cn("[writing-mode:vertical-lr]", "[writing-mode:horizontal-tb]")).toBe("[writing-mode:horizontal-tb]");
  });

  it("keeps arbitrary declarations of different properties", () => {
    expect(cn("[direction:rtl]", "[scrollbar-width:thin]")).toBe("[direction:rtl] [scrollbar-width:thin]");
  });
});

describe("cn importance", () => {
  it("keeps an important utility ahead of a later normal one", () => {
    expect(cn("h-full!", "h-5")).toBe("h-full! h-5");
  });

  it("resolves two important utilities against each other", () => {
    expect(cn("h-full!", "h-5!")).toBe("h-5!");
  });

  it("resolves the leading-bang spelling the same way", () => {
    expect(cn("!h-full", "!h-5")).toBe("!h-5");
  });
});

describe("cn negative and fractional values", () => {
  const cases: { input: [string, string]; expected: string }[] = [
    { input: ["mt-1", "-mt-2"], expected: "-mt-2" },
    { input: ["w-full", "w-1/2"], expected: "w-1/2" },
    { input: ["left-0", "left-1/2"], expected: "left-1/2" },
  ];

  for (const { input, expected } of cases) {
    it(`cn("${input[0]}", "${input[1]}") === "${expected}"`, () => {
      expect(cn(input[0], input[1])).toBe(expected);
    });
  }
});

describe("cn logical inset utilities", () => {
  const cases: { input: [string, string]; expected: string }[] = [
    { input: ["start-0", "start-4"], expected: "start-4" },
    { input: ["end-0", "end-4"], expected: "end-4" },
    { input: ["start-0", "start-[3px]"], expected: "start-[3px]" },
    { input: ["max-md:start-0", "max-md:start-8"], expected: "max-md:start-8" },
    { input: ["max-md:end-0", "max-md:end-8"], expected: "max-md:end-8" },
    { input: ["start-4", "end-4"], expected: "start-4 end-4" },
    { input: ["start-4", "inset-s-0"], expected: "inset-s-0" },
  ];

  for (const { input, expected } of cases) {
    it(`cn("${input[0]}", "${input[1]}") === "${expected}"`, () => {
      expect(cn(input[0], input[1])).toBe(expected);
    });
  }
});

describe("cn override relations", () => {
  const cases: { shorthand: string; longhand: string; collapsed: string; narrowed: string }[] = [
    { shorthand: "p-4", longhand: "px-2", collapsed: "p-4", narrowed: "p-4 px-2" },
    { shorthand: "size-6", longhand: "w-4", collapsed: "size-6", narrowed: "size-6 w-4" },
    { shorthand: "inset-y-2", longhand: "top-0", collapsed: "inset-y-2", narrowed: "inset-y-2 top-0" },
    { shorthand: "rounded-lg", longhand: "rounded-tl-md", collapsed: "rounded-lg", narrowed: "rounded-lg rounded-tl-md" },
    { shorthand: "scroll-p-4", longhand: "scroll-pl-2", collapsed: "scroll-p-4", narrowed: "scroll-p-4 scroll-pl-2" },
    { shorthand: "scroll-m-4", longhand: "scroll-mt-2", collapsed: "scroll-m-4", narrowed: "scroll-m-4 scroll-mt-2" },
    { shorthand: "flex-1", longhand: "basis-1/2", collapsed: "flex-1", narrowed: "flex-1 basis-1/2" },
    {
      shorthand: "place-content-center",
      longhand: "content-start",
      collapsed: "place-content-center",
      narrowed: "place-content-center content-start",
    },
    { shorthand: "place-items-end", longhand: "items-center", collapsed: "place-items-end", narrowed: "place-items-end items-center" },
    { shorthand: "place-self-center", longhand: "self-start", collapsed: "place-self-center", narrowed: "place-self-center self-start" },
  ];

  for (const { shorthand, longhand, collapsed, narrowed } of cases) {
    it(`"${shorthand}" after "${longhand}" consumes it`, () => {
      expect(cn(longhand, shorthand)).toBe(collapsed);
    });

    it(`"${longhand}" after "${shorthand}" narrows rather than conflicts`, () => {
      expect(cn(shorthand, longhand)).toBe(narrowed);
    });
  }
});

// Held as consts: the formatter's class sorter rewrites a literal written inside a `cn(…)` call.
const NAVBAR_BASE = "group z-40 bg-background/95 backdrop-blur";
const NAVBAR_TOP = "sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto";

describe("cn real component strings", () => {
  it("round-trips the navbar placement base and top variant byte-for-byte", () => {
    expect(cn(NAVBAR_BASE, NAVBAR_TOP)).toBe(`${NAVBAR_BASE} ${NAVBAR_TOP}`);
  });
});

describe("cn non-conflicting utilities that share a prefix", () => {
  const cases: { literal: string }[] = [
    { literal: "bg-red-500 bg-blend-multiply" },
    { literal: "bg-red-500 bg-clip-padding" },
    { literal: "bg-red-500 bg-origin-border" },
    { literal: "text-red-500 text-shadow-md" },
    { literal: "text-shadow-md text-shadow-red-500" },
    { literal: "ring-offset-2 ring-offset-red-500" },
    { literal: "border-red-500 border-be-2" },
    { literal: "inset-0 inset-be-4" },
    { literal: "ordinal tabular-nums" },
  ];

  for (const { literal } of cases) {
    it(`keeps both classes in "${literal}"`, () => {
      expect(cn(literal)).toBe(literal);
    });
  }
});

// Held as consts: the formatter's class sorter rewrites a literal written inside a `cn(…)` call.
const LENGTH_THEN_COLOR = "text-[14px] text-red-500";
const TWO_TEXT_COLORS = "text-red-500 text-blue-500";
const TOP_THEN_LEFT_CORNERS = "rounded-t-md rounded-l-lg";
const SCALE_THEN_COLOR = "text-size-hero text-red-500";
const SCALE_THEN_SIZE = "text-size-hero text-2xl";
const AMBIGUOUS_THEN_COLOR = "text-hero text-red-500";

describe("cn arbitrary-value discrimination", () => {
  it("reads an arbitrary length under `text-` as a font size, not a colour", () => {
    expect(cn(LENGTH_THEN_COLOR)).toBe(LENGTH_THEN_COLOR);
  });

  it("still resolves two colours under `text-` to the later one", () => {
    expect(cn(TWO_TEXT_COLORS)).toBe("text-blue-500");
  });
});

describe("cn partially overlapping corners", () => {
  it("keeps both when neither corner set contains the other", () => {
    expect(cn(TOP_THEN_LEFT_CORNERS)).toBe(TOP_THEN_LEFT_CORNERS);
  });
});

describe("cn and the reserved `text-size-*` namespace", () => {
  it("keeps an app's size step beside a colour, because the two set different concerns", () => {
    expect(cn(SCALE_THEN_COLOR)).toBe(SCALE_THEN_COLOR);
  });

  it("resolves it against a Tailwind size, which is the concern it shares", () => {
    expect(cn(SCALE_THEN_SIZE)).toBe("text-2xl");
  });

  it("lets a named step displace an arbitrary one, which is the concern the two spellings share", () => {
    expect(cn("text-size-[20px]", "text-size-hero")).toBe("text-size-hero");
  });

  it("keeps a later arbitrary size beside a named step, which also carries a line height", () => {
    expect(cn("text-size-hero", "text-size-[20px]")).toBe("text-size-hero text-size-[20px]");
  });

  it("still drops the same step declared as `--text-hero`, which is what the reserved namespace exists to avoid", () => {
    expect(cn(AMBIGUOUS_THEN_COLOR)).toBe("text-red-500");
  });
});

describe("cn — the @utility recipes", () => {
  it("dedupes a repeated recipe and keeps a caller's narrower utility after field-chrome", () => {
    expect(cn("focus-ring", "focus-ring")).toBe("focus-ring");
    expect(cn("field-chrome", "rounded-lg")).toBe("field-chrome rounded-lg");
    expect(cn("field-chrome", "h-8")).toBe("field-chrome h-8");
    expect(cn("border-field", "border-input")).toBe("border-field border-input");
    expect(cn("rounded-lg", "field-chrome")).toBe("field-chrome");
  });

  // A state recipe paints nothing until its own selector matches, so no unconditional utility can
  // conflict with it. Before the generator gave the five their own slot, `state-invalid` shared
  // `--tw-ring-color` with every `ring-*` and a caller's ring silently deleted the invalid styling.
  it("keeps a state recipe beside any caller utility, in either order", () => {
    expect(cn("state-invalid", "ring-primary")).toBe("state-invalid ring-primary");
    expect(cn("ring-primary", "state-invalid")).toBe("ring-primary state-invalid");
    expect(cn("state-invalid", "focus-ring-outset")).toBe("state-invalid focus-ring-outset");
    expect(cn("focus-ring-outset", "state-invalid")).toBe("focus-ring-outset state-invalid");
    expect(cn("state-disabled", "opacity-75")).toBe("state-disabled opacity-75");
    expect(cn("state-busy", "cursor-wait")).toBe("state-busy cursor-wait");
    expect(cn("focus-ring", "outline-none")).toBe("focus-ring outline-none");
  });

  it("still dedupes a state recipe against itself, so the slot is a slot and not an escape hatch", () => {
    expect(cn("state-invalid", "state-invalid")).toBe("state-invalid");
    expect(cn("focus-ring", "focus-ring-outset")).toBe("focus-ring focus-ring-outset");
  });
});

// Held as consts: the formatter's class sorter rewrites a literal written inside a `cn(…)` call.
const PADDING_PAIR = "p-4 p-8";
const HEIGHT_PAIR = "h-full h-5";

describe("cn memoisation", () => {
  it("returns the same string for a repeated call as for a fresh one", () => {
    expect(cn("flex", "items-center", "gap-2")).toBe("flex items-center gap-2");
    expect(cn("flex", "items-center", "gap-2")).toBe("flex items-center gap-2");
  });

  it("agrees across argument splittings that join to the same string", () => {
    expect(cn("p-4", "p-8")).toBe("p-8");
    expect(cn(PADDING_PAIR)).toBe("p-8");
  });

  it("agrees whether or not a falsy entry sits between two classes", () => {
    expect(cn("h-full", false, "h-5")).toBe("h-5");
    expect(cn("h-full", null, "h-5")).toBe("h-5");
    expect(cn(HEIGHT_PAIR)).toBe("h-5");
  });

  it("resolves every key correctly across more distinct keys than the cache holds", () => {
    for (let i = 0; i < 600; i += 1) {
      expect(cn("h-full", `h-[${i}px]`)).toBe(`h-[${i}px]`);
    }
  });

  it("still resolves an early key after later keys have filled and reset the cache", () => {
    expect(cn("h-full", "h-[0px]")).toBe("h-[0px]");

    for (let i = 1000; i < 1600; i += 1) {
      expect(cn("h-full", `h-[${i}px]`)).toBe(`h-[${i}px]`);
    }

    expect(cn("h-full", "h-[0px]")).toBe("h-[0px]");
  });

  it("caches the resolved string rather than the joined input", () => {
    expect(cn("inline-flex", "flex")).toBe("flex");
    expect(cn("inline-flex", "flex")).toBe("flex");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });
});

describe("utilityOf", () => {
  it("returns a bare utility unchanged", () => {
    expect(utilityOf("focus-ring-outset")).toBe("focus-ring-outset");
  });

  it("drops every variant, however many", () => {
    expect(utilityOf("hover:bg-primary")).toBe("bg-primary");
    expect(utilityOf("md:hover:focus-visible:ring-2")).toBe("ring-2");
  });

  it("drops the `!` important marker on either side", () => {
    expect(utilityOf("!p-4")).toBe("p-4");
    expect(utilityOf("p-4!")).toBe("p-4");
  });

  it("drops a `/value` suffix, and keeps a slash inside brackets", () => {
    expect(utilityOf("bg-muted/40")).toBe("bg-muted");
    expect(utilityOf("group/filter")).toBe("group");
    expect(utilityOf("[&>*]:[grid-area:1/1]")).toBe("[grid-area:1/1]");
  });

  it("keeps a colon inside brackets, which is a selector rather than a variant separator", () => {
    expect(utilityOf("has-[select:disabled]:opacity-50")).toBe("opacity-50");
    expect(utilityOf("[scrollbar-color:var(--color-border)_transparent]")).toBe("[scrollbar-color:var(--color-border)_transparent]");
  });
});
