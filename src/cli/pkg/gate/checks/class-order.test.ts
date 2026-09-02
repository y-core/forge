import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkClassOrder, droppedToken, validateClassOrder } from "./class-order";

/** A throwaway repository root holding exactly the files given. */
function fixtureRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "forge-class-order-check-"));
  for (const [path, source] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, "utf-8");
  }
  return root;
}

describe("droppedToken", () => {
  it("returns null for a literal no token of which conflicts", () => {
    expect(droppedToken("flex items-center gap-2 rounded-lg")).toBe(null);
  });

  it("names the token a later same-group token displaces", () => {
    expect(droppedToken("p-4 flex p-8")).toBe("p-4");
  });

  it("names the token a shorthand override consumes", () => {
    expect(droppedToken("px-2 p-4")).toBe("px-2");
  });

  it("returns null for a literal that only differs by whitespace", () => {
    expect(droppedToken("  flex   p-4 ")).toBe(null);
  });

  it("returns null when two same-named utilities sit under different modifiers", () => {
    expect(droppedToken("p-4 md:p-8")).toBe(null);
  });

  it("returns null for the wrapping utilities a colour once displaced", () => {
    expect(droppedToken("text-sm text-muted-foreground text-pretty")).toBe(null);
  });
});

describe("validateClassOrder", () => {
  it("reports a self-conflicting `class` attribute with the file, the line and the dropped token", () => {
    const findings = validateClassOrder("src/a.tsx", "const A = () => <div class='p-4 flex p-8' />;\n");

    expect(findings).toEqual([
      {
        level: "fail",
        message: "class literal is not a fixed point of `cn`",
        file: "src/a.tsx",
        line: 1,
        detail: ["`p-4 flex p-8`", "`p-4` is dropped — two tokens claim one conflict group, so sorting the literal would change what it renders"],
      },
    ]);
  });

  it("reports a `className` attribute", () => {
    expect(validateClassOrder("src/a.tsx", 'const A = () => <div className="h-4 h-8" />;\n').map((f) => f.line)).toEqual([1]);
  });

  it("reaches a `cn` argument list wrapped across lines", () => {
    const source = ["const a = cn(", '  "flex items-center",', '  "rounded-lg rounded-md",', ");", ""].join("\n");

    expect(validateClassOrder("src/a.ts", source).map((f) => f.line)).toEqual([3]);
  });

  it("reaches a `cva` variant map", () => {
    const source = ["const v = cva({", '  base: "inline-flex gap-2",', '  variants: { size: { sm: "h-8 h-9" } },', "});", ""].join("\n");

    expect(validateClassOrder("src/a.ts", source).map((f) => f.line)).toEqual([3]);
  });

  it("reaches an `asClass` argument", () => {
    expect(validateClassOrder("src/a.ts", 'const a = asClass("w-4 w-8");\n').map((f) => f.line)).toEqual([1]);
  });

  it("does not judge a string outside a class position", () => {
    expect(validateClassOrder("src/a.ts", 'const label = "p-4 p-8";\n')).toEqual([]);
  });

  it("does not judge a literal inside a block comment", () => {
    expect(validateClassOrder("src/a.ts", '/* class="p-4 p-8" */\nconst a = 1;\n')).toEqual([]);
  });

  it("does not judge a conflict spread across two arguments, which `cn` resolves by design", () => {
    expect(validateClassOrder("src/a.ts", 'const a = cn("p-4", "p-8");\n')).toEqual([]);
  });

  it("reports one finding per literal, not one per token pair", () => {
    expect(validateClassOrder("src/a.tsx", "const A = () => <div class='p-4 p-6 p-8' />;\n")).toHaveLength(1);
  });
});

describe("checkClassOrder", () => {
  it("passes a tree whose every literal is a fixed point", () => {
    const root = fixtureRoot({ "src/a.tsx": "const A = () => <div class='flex items-center gap-2' />;\n" });
    const result = checkClassOrder({ root, sources: ["src"] });

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("1 files: every class literal is a fixed point of `cn`");
  });

  it("fails a tree holding one self-conflicting literal", () => {
    const root = fixtureRoot({ "src/a.tsx": "const A = () => <div class='p-4 p-8' />;\n" });
    const result = checkClassOrder({ root, sources: ["src"] });

    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.file)).toEqual(["src/a.tsx"]);
  });

  it("honours a `!`-prefixed file exclusion", () => {
    const root = fixtureRoot({
      "src/a.tsx": "const A = () => <div class='p-4 p-8' />;\n",
      "src/b.tsx": "const B = () => <div class='flex gap-2' />;\n",
    });

    expect(checkClassOrder({ root, sources: ["src", "!src/a.tsx"] }).ok).toBe(true);
  });

  it("honours a `!`-prefixed directory exclusion", () => {
    const root = fixtureRoot({
      "src/fixtures/a.tsx": "const A = () => <div class='p-4 p-8' />;\n",
      "src/b.tsx": "const B = () => <div class='flex gap-2' />;\n",
    });

    expect(checkClassOrder({ root, sources: ["src", "!src/fixtures"] }).ok).toBe(true);
  });

  it("refuses a green verdict when it scanned nothing", () => {
    const root = fixtureRoot({ "src/a.css": ".a { color: red; }\n" });
    const result = checkClassOrder({ root, sources: ["src"] });

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe("`src` matched no source — refusing to report a green class-order gate that scanned nothing");
  });
});

describe("validateClassOrder — a `+` chain", () => {
  it("judges concatenated chunks as one literal", () => {
    expect(validateClassOrder("src/a.ts", 'const a = cn("flex p-4 " + "p-8 gap-2");\n').map((f) => f.detail?.[0])).toEqual([
      "`flex p-4 p-8 gap-2`",
    ]);
  });

  it("leaves two separate arguments separate", () => {
    expect(validateClassOrder("src/a.ts", 'const a = cn("flex p-4", "p-8 gap-2");\n')).toEqual([]);
  });
});
