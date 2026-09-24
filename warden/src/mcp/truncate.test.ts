import { describe, expect, it } from "bun:test";

import { truncate } from "./truncate";

describe("truncate()", () => {
  it("leaves a response that fits exactly as it was", () => {
    expect(truncate("A short section.", "docs/A.md")).toBe("A short section.");
  });

  it("cuts an oversized response to the cap", () => {
    const cut = truncate("x".repeat(30_000), "docs/A.md");

    expect(cut.startsWith("x".repeat(24_000))).toBe(true);
    expect(cut.charAt(24_000)).toBe("\n");
  });

  // A bare ellipsis leaves a reader to guess whether the rule they wanted was in the part dropped.
  it("names the two tools that reach the missing part, and the document they take", () => {
    const tail = truncate("x".repeat(30_000), "docs/NAMESPACES.md").slice(24_000);

    expect(tail).toBe(
      "\n\n--- TRUNCATED ---\nResponse was ~7,500 tokens (limit: 6,000). Use knowledge_outline on docs/NAMESPACES.md and knowledge_read the one section you need.",
    );
  });
});
