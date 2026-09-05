import { describe, expect, it } from "bun:test";

import { cn } from "./cn";
import { APPEARANCES, TONES, toneTokens, toneVariants } from "./tone";

const NEUTRAL =
  "[--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)]";

describe("toneVariants", () => {
  it("defaults to neutral solid", () => {
    expect(toneVariants()).toBe(
      `${NEUTRAL} border-transparent bg-(--tone) text-(--tone-fg) [--focus-ring:var(--tone-fg)] hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]`,
    );
  });

  it("sets each of the six tone properties exactly once in every tone × appearance cell", () => {
    const names = ["--tone", "--tone-fg", "--tone-text", "--tone-soft", "--tone-soft-fg", "--tone-soft-border"];
    for (const tone of TONES) {
      for (const appearance of APPEARANCES) {
        const tokens = toneVariants({ tone, appearance }).split(" ");
        expect(names.map((name) => tokens.filter((token) => token.startsWith(`[${name}:`)).length)).toEqual([1, 1, 1, 1, 1, 1]);
      }
    }
  });

  it("lets a later tone property replace an earlier one through cn, since each custom property is its own conflict group", () => {
    expect(cn(toneVariants({ tone: "primary", appearance: "link" }), "[--tone-text:var(--color-info-text)]")).toBe(
      "[--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)] [--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)] [--tone-soft-border:var(--color-primary-soft-border)] border-transparent bg-transparent text-(--tone-text) [--focus-ring:var(--color-ring)] underline-offset-4 hover:underline [--tone-text:var(--color-info-text)]",
    );
    expect(cn(toneVariants({ appearance: "outline" }), "bg-muted")).toBe(
      `${NEUTRAL} border-(--tone-text) text-(--tone-text) [--focus-ring:var(--color-ring)] hover:bg-(--tone-soft) bg-muted`,
    );
  });

  // The reason the ring is not simply `--ring`: it is drawn inside the element, and a gray step
  // measures 1.03 against `--primary` in light. Only a solid fill has an audited foreground to use.
  it("names the ring colour the appearance is read against, and never inherits a solid ancestor's", () => {
    for (const tone of TONES) {
      const cells = APPEARANCES.map((appearance) => {
        const token = toneVariants({ tone, appearance })
          .split(" ")
          .filter((entry) => entry.startsWith("[--focus-ring:"));
        return token.length === 1 ? token[0] : token;
      });
      expect(cells).toEqual([
        "[--focus-ring:var(--tone-fg)]",
        "[--focus-ring:var(--color-ring)]",
        "[--focus-ring:var(--color-ring)]",
        "[--focus-ring:var(--color-ring)]",
        "[--focus-ring:var(--color-ring)]",
      ]);
    }
  });
});

describe("toneTokens", () => {
  it("keeps the six tone properties and drops every paint utility", () => {
    expect(toneTokens("neutral")).toBe(NEUTRAL);
    expect(
      toneTokens("neutral")
        .split(" ")
        .every((token) => token.startsWith("[--tone")),
    ).toBe(true);
  });

  it("is exactly the tone half of the solid recipe, for every tone", () => {
    for (const tone of TONES) {
      expect(toneTokens(tone)).toBe(
        toneVariants({ tone, appearance: "solid" })
          .split(" ")
          .filter((token) => token.startsWith("[--tone"))
          .join(" "),
      );
    }
  });
});
