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
