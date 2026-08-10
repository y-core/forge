import { describe, expect, it } from "bun:test";
import { classGroup, GROUP_OVERRIDES } from "./class-groups";

// `classGroup` receives a utility that has already had its modifier prefix, importance marker and
// value slash stripped by `cn` — never a full token such as `hover:h-5` or `bg-primary/90`.

describe("classGroup exact families", () => {
  const cases: { utility: string; expected: string }[] = [
    { utility: "block", expected: "display" },
    { utility: "inline-flex", expected: "display" },
    { utility: "hidden", expected: "display" },
    { utility: "absolute", expected: "position" },
    { utility: "sticky", expected: "position" },
    { utility: "select-none", expected: "user-select" },
    { utility: "pointer-events-none", expected: "pointer-events" },
    { utility: "overflow-hidden", expected: "overflow" },
    { utility: "overflow-x-auto", expected: "overflow-x" },
    { utility: "overflow-y-scroll", expected: "overflow-y" },
    { utility: "overscroll-contain", expected: "overscroll" },
    { utility: "overscroll-x-none", expected: "overscroll-x" },
    { utility: "overscroll-y-auto", expected: "overscroll-y" },
    { utility: "object-cover", expected: "object-fit" },
    { utility: "uppercase", expected: "text-transform" },
    { utility: "underline", expected: "text-decoration" },
    { utility: "invisible", expected: "visibility" },
    { utility: "tabular-nums", expected: "font-variant-numeric" },
    { utility: "sr-only", expected: "sr-only" },
    { utility: "border-collapse", expected: "border-collapse" },
    { utility: "truncate", expected: "truncate" },
    { utility: "rounded", expected: "rounded" },
    { utility: "shadow", expected: "shadow" },
    { utility: "ring", expected: "ring-w" },
    { utility: "outline", expected: "outline-w" },
  ];

  for (const { utility, expected } of cases) {
    it(`classGroup("${utility}") === "${expected}"`, () => {
      expect(classGroup(utility)).toBe(expected);
    });
  }
});

describe("classGroup prefix families", () => {
  const cases: { utility: string; expected: string }[] = [
    { utility: "p-4", expected: "p" },
    { utility: "px-2", expected: "px" },
    { utility: "pt-1", expected: "pt" },
    { utility: "m-4", expected: "m" },
    { utility: "my-2", expected: "my" },
    { utility: "w-full", expected: "w" },
    { utility: "h-[3px]", expected: "h" },
    { utility: "size-6", expected: "size" },
    { utility: "gap-2", expected: "gap" },
    { utility: "gap-x-2", expected: "gap-x" },
    { utility: "z-40", expected: "z" },
    { utility: "opacity-50", expected: "opacity" },
    { utility: "inset-0", expected: "inset" },
    { utility: "inset-y-2", expected: "inset-y" },
    { utility: "top-0", expected: "top" },
    { utility: "left-1/2", expected: "left" },
    { utility: "leading-none", expected: "leading" },
    { utility: "tracking-tight", expected: "tracking" },
    { utility: "translate-x-4", expected: "translate-x" },
    { utility: "animate-spin", expected: "animate" },
    { utility: "duration-200", expected: "duration" },
    { utility: "object-top", expected: "object-position" },
    { utility: "rounded-lg", expected: "rounded" },
    { utility: "rounded-tl-md", expected: "rounded-tl" },
    { utility: "rounded-b-none", expected: "rounded-b" },
    { utility: "bg-fixed", expected: "bg-attachment" },
    { utility: "bg-no-repeat", expected: "bg-repeat" },
    { utility: "bg-cover", expected: "bg-size" },
    { utility: "bg-left-top", expected: "bg-position" },
    { utility: "bg-none", expected: "bg-image" },
    { utility: "bg-gradient-to-r", expected: "bg-image" },
    { utility: "bg-primary", expected: "bg-color" },
    { utility: "ring-inset", expected: "ring-inset" },
    { utility: "ring-offset-2", expected: "ring-offset" },
    { utility: "ring-2", expected: "ring-w" },
    { utility: "ring-ring", expected: "ring-color" },
    { utility: "shadow-lg", expected: "shadow" },
    { utility: "shadow-black", expected: "shadow-color" },
    { utility: "font-bold", expected: "font-weight" },
    { utility: "font-mono", expected: "font-family" },
    { utility: "outline-dashed", expected: "outline-style" },
    { utility: "outline-offset-2", expected: "outline-offset" },
    { utility: "outline-2", expected: "outline-w" },
    { utility: "outline-ring", expected: "outline-color" },
    { utility: "stroke-2", expected: "stroke-w" },
    { utility: "stroke-current", expected: "stroke-color" },
    { utility: "flex-col", expected: "flex-direction" },
    { utility: "flex-wrap", expected: "flex-wrap" },
    { utility: "flex-1", expected: "flex" },
  ];

  for (const { utility, expected } of cases) {
    it(`classGroup("${utility}") === "${expected}"`, () => {
      expect(classGroup(utility)).toBe(expected);
    });
  }
});

describe("classGroup text dispatcher", () => {
  const cases: { utility: string; expected: string }[] = [
    { utility: "text-sm", expected: "font-size" },
    { utility: "text-red-500", expected: "text-color" },
    { utility: "text-left", expected: "text-align" },
    { utility: "text-ellipsis", expected: "text-overflow" },
    { utility: "text-[11px]", expected: "font-size" },
  ];

  for (const { utility, expected } of cases) {
    it(`classGroup("${utility}") === "${expected}"`, () => {
      expect(classGroup(utility)).toBe(expected);
    });
  }
});

describe("classGroup border dispatcher", () => {
  const cases: { utility: string; expected: string }[] = [
    { utility: "border", expected: "border-w" },
    { utility: "border-2", expected: "border-w" },
    { utility: "border-b", expected: "border-w-b" },
    { utility: "border-b-2", expected: "border-w-b" },
    { utility: "border-b-red-500", expected: "border-color-b" },
    { utility: "border-dashed", expected: "border-style" },
    { utility: "border-input", expected: "border-color" },
  ];

  for (const { utility, expected } of cases) {
    it(`classGroup("${utility}") === "${expected}"`, () => {
      expect(classGroup(utility)).toBe(expected);
    });
  }
});

describe("classGroup alignment families", () => {
  const cases: { utility: string; expected: string }[] = [
    { utility: "items-center", expected: "align-items" },
    { utility: "self-start", expected: "align-self" },
    { utility: "justify-center", expected: "justify-content" },
    { utility: "justify-self-center", expected: "justify-self" },
    // Near-collision: `justify` is a text-align value, but TEXT_ALIGNS is only ever consulted on
    // the remainder after a `text-` prefix, so it can never claim the alignment families.
    { utility: "text-justify", expected: "text-align" },
  ];

  for (const { utility, expected } of cases) {
    it(`classGroup("${utility}") === "${expected}"`, () => {
      expect(classGroup(utility)).toBe(expected);
    });
  }
});

describe("classGroup cursor family", () => {
  it("claims a documented cursor value", () => {
    expect(classGroup("cursor-pointer")).toBe("cursor");
  });

  it("claims an arbitrary cursor value through the prefix dispatcher", () => {
    expect(classGroup("cursor-[url(a.png)]")).toBe("cursor");
  });

  it("leaves a consumer's custom cursor class alone", () => {
    expect(classGroup("cursor-brand")).toBeUndefined();
  });
});

describe("classGroup arbitrary properties", () => {
  it("names the declared property", () => {
    expect(classGroup("[writing-mode:vertical-lr]")).toBe("arb:writing-mode");
  });

  it("returns undefined for a bracket value with no property", () => {
    expect(classGroup("[3px]")).toBeUndefined();
  });
});

describe("classGroup negative values", () => {
  it("strips a leading minus before lookup", () => {
    expect(classGroup("-mt-2")).toBe("mt");
  });
});

describe("classGroup fail-open", () => {
  const cases: string[] = ["not-a-class", "group", "peer", "backdrop-blur", "select-wrapper", "self-wrapper", "justify-thing", ""];

  for (const utility of cases) {
    it(`classGroup("${utility}") === undefined`, () => {
      expect(classGroup(utility)).toBeUndefined();
    });
  }
});

describe("GROUP_OVERRIDES", () => {
  it("maps a shorthand to every longhand it consumes", () => {
    expect(GROUP_OVERRIDES.get("p")).toEqual(["px", "py", "pt", "pr", "pb", "pl", "ps", "pe"]);
  });

  it("maps an axis shorthand to its own longhands only", () => {
    expect(GROUP_OVERRIDES.get("inset-y")).toEqual(["top", "bottom"]);
  });

  it("expands per-side border widths", () => {
    expect(GROUP_OVERRIDES.get("border-w")).toEqual([
      "border-w-x",
      "border-w-y",
      "border-w-t",
      "border-w-r",
      "border-w-b",
      "border-w-l",
      "border-w-s",
      "border-w-e",
    ]);
  });

  it("gives flex an explicitly empty override list so display is never consumed", () => {
    expect(GROUP_OVERRIDES.get("flex")).toEqual([]);
  });

  it("has no reverse edge from a longhand to its shorthand", () => {
    expect(GROUP_OVERRIDES.get("px")).toEqual(["pl", "pr", "ps", "pe"]);
  });

  it("returns undefined for a group with no longhands", () => {
    expect(GROUP_OVERRIDES.get("display")).toBeUndefined();
  });
});
