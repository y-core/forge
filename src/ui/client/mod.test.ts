import { describe, expect, it } from "bun:test";

describe("ui/client outside a DOM", () => {
  it("runs where no DOM exists", () => {
    expect([typeof document, typeof window]).toEqual(["undefined", "undefined"]);
  });

  it("imports without throwing", async () => {
    await expect(import("./mod")).resolves.toHaveProperty("resume");
  });

  it("throws on the first call that touches the document", async () => {
    const { resume } = await import("./mod");

    expect(() => resume()).toThrow(ReferenceError);
  });
});
