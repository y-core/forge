import { describe, expect, it } from "bun:test";
import { cva } from "./cva";

describe("cva", () => {
  it("returns just the base class when no props are passed", () => {
    const styles = cva({ base: "base-class" });
    expect(styles()).toBe("base-class");
  });

  it("returns an empty string for an empty config", () => {
    const styles = cva({});
    expect(styles()).toBe("");
  });

  it("applies a default variant when no props are passed", () => {
    const styles = cva({ base: "base", variants: { color: { red: "text-red", blue: "text-blue" } }, defaultVariants: { color: "red" } });
    expect(styles()).toBe("base text-red");
  });

  it("overrides the default variant with an explicit prop", () => {
    const styles = cva({ base: "base", variants: { color: { red: "text-red", blue: "text-blue" } }, defaultVariants: { color: "red" } });
    expect(styles({ color: "blue" })).toBe("base text-blue");
  });

  it("applies classes from multiple variant axes", () => {
    const styles = cva({
      base: "base",
      variants: { size: { sm: "size-sm", lg: "size-lg" }, tone: { muted: "tone-muted", bold: "tone-bold" } },
      defaultVariants: { size: "sm", tone: "bold" },
    });
    expect(styles({ size: "lg", tone: "muted" })).toBe("base size-lg tone-muted");
  });

  it("appends the class prop after all variant classes", () => {
    const styles = cva({ base: "base", variants: { color: { red: "text-red" } }, defaultVariants: { color: "red" } });
    expect(styles({ class: "extra" })).toBe("base text-red extra");
  });

  it("returns only the class prop when config has no base or variants", () => {
    const styles = cva({});
    expect(styles({ class: "my-class" })).toBe("my-class");
  });
});

describe("cva conflict merging", () => {
  it("lets the class prop override a conflicting base utility", () => {
    const styles = cva({ base: "h-full" });
    expect(styles({ class: "h-5" })).toBe("h-5");
  });

  it("lets the class prop override a conflicting default-variant utility", () => {
    const styles = cva({ base: "p-2", variants: { size: { lg: "p-8" } }, defaultVariants: { size: "lg" } });
    expect(styles({ class: "p-0" })).toBe("p-0");
  });

  it("lets a variant override a conflicting base utility", () => {
    const styles = cva({ base: "p-2", variants: { size: { lg: "p-8" } } });
    expect(styles({ size: "lg" })).toBe("p-8");
  });

  it("merges base, variants and class in that order", () => {
    const styles = cva({ base: "rounded-sm p-2 text-xs", variants: { size: { lg: "p-8" } }, defaultVariants: { size: "lg" } });
    expect(styles({ class: "text-sm" })).toBe("rounded-sm p-8 text-sm");
  });
});
