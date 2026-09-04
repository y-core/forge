import { describe, expect, it } from "bun:test";

import { buttonVariants } from "../button";
import { classGroup, GROUP_OVERRIDES } from "./class-groups";
import { cn } from "./cn";

describe("classGroup static utilities", () => {
  const cases: { utility: string; expected: string }[] = [
    { utility: "block", expected: "display" },
    { utility: "inline-flex", expected: "display" },
    { utility: "hidden", expected: "display" },
    { utility: "flex", expected: "display" },
    { utility: "absolute", expected: "position" },
    { utility: "sticky", expected: "position" },
    { utility: "select-none", expected: "-webkit-user-select,user-select" },
    { utility: "pointer-events-none", expected: "pointer-events" },
    { utility: "overflow-hidden", expected: "overflow" },
    { utility: "overflow-x-auto", expected: "overflow-x" },
    { utility: "overflow-y-scroll", expected: "overflow-y" },
    { utility: "overscroll-contain", expected: "overscroll-behavior" },
    { utility: "overscroll-x-none", expected: "overscroll-behavior-x" },
    { utility: "object-cover", expected: "object-fit" },
    { utility: "uppercase", expected: "text-transform" },
    { utility: "underline", expected: "text-decoration-line" },
    { utility: "text-wrap", expected: "text-wrap" },
    { utility: "text-nowrap", expected: "text-wrap" },
    { utility: "text-balance", expected: "text-wrap" },
    { utility: "text-pretty", expected: "text-wrap" },
    { utility: "whitespace-nowrap", expected: "white-space" },
    { utility: "whitespace-pre-wrap", expected: "white-space" },
    { utility: "invisible", expected: "visibility" },
    { utility: "border-collapse", expected: "border-collapse" },
    { utility: "truncate", expected: "overflow,text-overflow,white-space" },
    { utility: "items-center", expected: "align-items" },
    { utility: "self-start", expected: "align-self" },
    { utility: "justify-center", expected: "justify-content" },
    { utility: "justify-self-center", expected: "justify-self" },
    { utility: "text-justify", expected: "text-align" },
    { utility: "flex-col", expected: "flex-direction" },
    { utility: "flex-wrap", expected: "flex-wrap" },
  ];

  for (const { utility, expected } of cases) {
    it(`classGroup("${utility}") === "${expected}"`, () => {
      expect(classGroup(utility)).toBe(expected);
    });
  }
});

describe("classGroup bare functional roots", () => {
  const cases: { utility: string; expected: string }[] = [
    { utility: "rounded", expected: "border-radius" },
    { utility: "border", expected: "border-style,border-width" },
    { utility: "ring", expected: "--tw-ring-shadow" },
    { utility: "shadow", expected: "--tw-shadow" },
    { utility: "outline", expected: "outline-style,outline-width" },
    { utility: "backdrop-blur", expected: "--tw-backdrop-blur" },
  ];

  for (const { utility, expected } of cases) {
    it(`classGroup("${utility}") === "${expected}"`, () => {
      expect(classGroup(utility)).toBe(expected);
    });
  }
});

describe("classGroup functional values", () => {
  const cases: { utility: string; expected: string }[] = [
    { utility: "p-4", expected: "padding" },
    { utility: "px-2", expected: "padding-inline" },
    { utility: "pt-1", expected: "padding-top" },
    { utility: "m-4", expected: "margin" },
    { utility: "my-2", expected: "margin-block" },
    { utility: "w-full", expected: "width" },
    { utility: "h-[3px]", expected: "height" },
    { utility: "size-6", expected: "height,width" },
    { utility: "gap-2", expected: "gap" },
    { utility: "gap-x-2", expected: "column-gap" },
    { utility: "z-40", expected: "z-index" },
    { utility: "opacity-50", expected: "opacity" },
    { utility: "inset-0", expected: "inset" },
    { utility: "inset-y-2", expected: "inset-block" },
    { utility: "top-0", expected: "top" },
    { utility: "left-1/2", expected: "left" },
    { utility: "leading-none", expected: "--tw-leading" },
    { utility: "tracking-tight", expected: "--tw-tracking" },
    { utility: "translate-x-4", expected: "--tw-translate-x" },
    { utility: "animate-spin", expected: "animation" },
    { utility: "duration-200", expected: "--tw-duration" },
    { utility: "object-top", expected: "object-position" },
    { utility: "rounded-lg", expected: "border-radius" },
    { utility: "rounded-tl-md", expected: "border-top-left-radius" },
    { utility: "rounded-b-none", expected: "border-bottom-left-radius,border-bottom-right-radius" },
    { utility: "font-stretch-normal", expected: "font-stretch" },
    { utility: "outline-offset-2", expected: "outline-offset" },
    { utility: "flex-1", expected: "flex" },
  ];

  for (const { utility, expected } of cases) {
    it(`classGroup("${utility}") === "${expected}"`, () => {
      expect(classGroup(utility)).toBe(expected);
    });
  }
});

describe("classGroup value discriminators", () => {
  const cases: { utility: string; expected: string }[] = [
    { utility: "bg-primary", expected: "background-color" },
    { utility: "bg-none", expected: "background-image" },
    { utility: "bg-fixed", expected: "background-attachment" },
    { utility: "bg-no-repeat", expected: "background-repeat" },
    { utility: "bg-cover", expected: "background-size" },
    { utility: "bg-left-top", expected: "background-position" },
    { utility: "bg-blend-multiply", expected: "background-blend-mode" },
    { utility: "bg-clip-padding", expected: "background-clip" },
    { utility: "bg-origin-border", expected: "background-origin" },
    { utility: "text-sm", expected: "font-size,line-height" },
    { utility: "text-[11px]", expected: "font-size" },
    { utility: "text-destructive", expected: "color" },
    { utility: "text-left", expected: "text-align" },
    { utility: "text-ellipsis", expected: "text-overflow" },
    { utility: "text-shadow-md", expected: "text-shadow" },
    { utility: "text-shadow-red-500", expected: "--tw-text-shadow-color" },
    { utility: "ring-2", expected: "--tw-ring-shadow" },
    { utility: "ring-ring", expected: "--tw-ring-color" },
    { utility: "ring-inset", expected: "--tw-ring-inset" },
    { utility: "ring-offset-2", expected: "--tw-ring-offset-shadow,--tw-ring-offset-width" },
    { utility: "ring-offset-red-500", expected: "--tw-ring-offset-color" },
    { utility: "shadow-lg", expected: "--tw-shadow" },
    { utility: "shadow-black", expected: "--tw-shadow-color" },
    { utility: "font-bold", expected: "--tw-font-weight" },
    { utility: "font-mono", expected: "font-family" },
    { utility: "outline-2", expected: "outline-style,outline-width" },
    { utility: "outline-ring", expected: "outline-color" },
    { utility: "stroke-2", expected: "stroke-width" },
    { utility: "stroke-current", expected: "stroke" },
    { utility: "border-2", expected: "border-style,border-width" },
    { utility: "border-input", expected: "border-color" },
    { utility: "border-b", expected: "border-bottom-style,border-bottom-width" },
    { utility: "border-b-2", expected: "border-bottom-style,border-bottom-width" },
    { utility: "border-b-red-500", expected: "border-bottom-color" },
    { utility: "border-be-2", expected: "border-block-end-style,border-block-end-width" },
    { utility: "inset-be-4", expected: "inset-block-end" },
    { utility: "ordinal", expected: "--tw-ordinal" },
    { utility: "tabular-nums", expected: "--tw-numeric-spacing" },
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

  it("claims an arbitrary cursor value", () => {
    expect(classGroup("cursor-[url(a.png)]")).toBe("cursor");
  });

  it("leaves a consumer's custom cursor class alone, because no named `cursor-*` value is a functional one", () => {
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
    expect(classGroup("-mt-2")).toBe("margin-top");
  });
});

describe("classGroup fail-open", () => {
  const cases: string[] = ["not-a-class", "group", "peer", "select-wrapper", "self-wrapper", "justify-thing", ""];

  for (const utility of cases) {
    it(`classGroup("${utility}") === undefined`, () => {
      expect(classGroup(utility)).toBeUndefined();
    });
  }
});

describe("classGroup screen-reader merge", () => {
  it("puts `sr-only` and `not-sr-only` in one group, because they are one concern by intent", () => {
    expect(classGroup("sr-only")).toBe("sr-only");
    expect(classGroup("not-sr-only")).toBe("sr-only");
  });

  it("gives that merged group no override edges, so it swallows no unrelated utility", () => {
    expect(GROUP_OVERRIDES.get("sr-only")).toBeUndefined();
  });
});

describe("GROUP_OVERRIDES", () => {
  it("maps a shorthand to every longhand it hides, physical and logical alike", () => {
    expect(GROUP_OVERRIDES.get("padding")).toEqual([
      "padding-block",
      "padding-block-end",
      "padding-block-start",
      "padding-bottom",
      "padding-inline",
      "padding-inline-end",
      "padding-inline-start",
      "padding-left",
      "padding-right",
      "padding-top",
    ]);
  });

  it("maps an axis shorthand to its own longhands only", () => {
    expect(GROUP_OVERRIDES.get("inset-block")).toEqual(["bottom", "inset-block-end", "inset-block-start", "top"]);
  });

  it("has no reverse edge from a longhand to its shorthand", () => {
    expect(GROUP_OVERRIDES.get("padding-inline")).toEqual(["padding-inline-end", "padding-inline-start", "padding-left", "padding-right"]);
  });

  it("derives a multi-property utility's edges from its signature, with no closure row needed", () => {
    expect(GROUP_OVERRIDES.get("height,width")).toEqual(["height", "width"]);
  });

  it("returns undefined for a group with no longhands", () => {
    expect(GROUP_OVERRIDES.get("display")).toBeUndefined();
  });
});

// Held as consts: the formatter's class sorter rewrites a literal written inside a `cn(…)` call.
const NOWRAP_THEN_NORMAL = "whitespace-nowrap whitespace-normal";
const BUTTON_WRAPPING_NORMALLY =
  "inline-flex items-center justify-center rounded-lg font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 motion-safe:transition-colors bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 text-sm whitespace-normal";

describe("cn whitespace group", () => {
  it("resolves two whitespace utilities in one string to the later one", () => {
    expect(cn(NOWRAP_THEN_NORMAL)).toBe("whitespace-normal");
  });

  it("lets a caller's whitespace-normal displace the button base's whitespace-nowrap", () => {
    expect(cn(buttonVariants(), "whitespace-normal")).toBe(BUTTON_WRAPPING_NORMALLY);
  });
});
