import { describe, expect, it } from "bun:test";
import { cn } from "./cn";

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

  // A caller's height override reaching a component base, which is the shape that sent the vertical
  // Separator looking for a call-site workaround before its base was fixed.
  it("lets a caller's height displace a base height inside a longer class string", () => {
    expect(cn("h-full w-px border-0 bg-border", "h-5")).toBe("w-px border-0 bg-border h-5");
  });

  // display, align-items and gap are three separate groups — this passes because they genuinely
  // do not conflict, not because `items-center` is outside the table.
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

  // The case the decision was opened for: a caller's layout override replaces the component's
  // own, rather than tying with it and leaving sheet order to decide.
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
  ];

  for (const { input, expected, why } of cases) {
    it(`cn("${input[0]}", "${input[1]}") === "${expected}" — ${why}`, () => {
      expect(cn(input[0], input[1])).toBe(expected);
    });
  }

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
  // A deliberate divergence from tailwind-merge: `!important` wins the cascade regardless of
  // source order, so an important utility is never displaced by a later normal one.
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

describe("cn override relations", () => {
  // One-directional: a shorthand consumes its longhands, never the reverse — a longhand after a
  // shorthand is a deliberate narrowing, not a conflict.
  const cases: { shorthand: string; longhand: string; collapsed: string; narrowed: string }[] = [
    { shorthand: "p-4", longhand: "px-2", collapsed: "p-4", narrowed: "p-4 px-2" },
    { shorthand: "size-6", longhand: "w-4", collapsed: "size-6", narrowed: "size-6 w-4" },
    { shorthand: "inset-y-2", longhand: "top-0", collapsed: "inset-y-2", narrowed: "inset-y-2 top-0" },
    { shorthand: "rounded-lg", longhand: "rounded-tl-md", collapsed: "rounded-lg", narrowed: "rounded-lg rounded-tl-md" },
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

describe("cn real component strings", () => {
  it("round-trips the navbar placement base and top variant byte-for-byte", () => {
    expect(
      cn("group z-40 border-border bg-background/95 backdrop-blur", "sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"),
    ).toBe("group z-40 border-border bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto");
  });
});
