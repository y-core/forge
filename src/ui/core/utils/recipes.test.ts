import { describe, expect, it } from "bun:test";

import { cn } from "./cn";
import { PRESSED_PAINT } from "./recipes";

describe("PRESSED_PAINT", () => {
  it("is the literal unchanged, so wrapping it in cn for the sorter's benefit resolves no conflict", () => {
    expect(PRESSED_PAINT).toBe("has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary");
  });

  it("keeps each token in its own cn scope, so a base-scope paint beside it survives", () => {
    expect(cn("bg-transparent text-foreground", PRESSED_PAINT)).toBe(
      "bg-transparent text-foreground has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary",
    );
  });
});
