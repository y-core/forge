import { describe, expect, it } from "bun:test";
import { addCommand, createCommand } from "./command";
import { formatHelp, formatUsage } from "./help";

describe("formatUsage()", () => {
  it("includes command name", () => {
    const cmd = createCommand({ name: "mytool" });
    expect(formatUsage(cmd)).toContain("mytool");
  });

  it("includes [flags]", () => {
    const cmd = createCommand({ name: "mytool" });
    expect(formatUsage(cmd)).toContain("[flags]");
  });

  it("includes full path for nested subcommand", () => {
    const root = createCommand({ name: "root" });
    const sub = createCommand({ name: "sub" });
    addCommand(root, sub);
    expect(formatUsage(sub)).toContain("root sub");
  });

  it("includes [command] when subcommands exist", () => {
    const root = createCommand({ name: "root" });
    addCommand(root, createCommand({ name: "sub" }));
    expect(formatUsage(root)).toContain("[command]");
  });

  it("omits [command] for leaf commands", () => {
    const cmd = createCommand({ name: "leaf" });
    expect(formatUsage(cmd)).not.toContain("[command]");
  });

  it("includes [args] when args validator is not none", () => {
    const cmd = createCommand({ name: "foo", args: { kind: "min", min: 1 } });
    expect(formatUsage(cmd)).toContain("[args]");
  });

  it("omits [args] when args validator is none", () => {
    const cmd = createCommand({ name: "foo" });
    expect(formatUsage(cmd)).not.toContain("[args]");
  });
});

describe("formatHelp()", () => {
  it("includes description when set", () => {
    const cmd = createCommand({ name: "foo", description: "Foo does things" });
    expect(formatHelp(cmd)).toContain("Foo does things");
  });

  it("always includes --help and -h flags", () => {
    const cmd = createCommand({ name: "foo" });
    const help = formatHelp(cmd);
    expect(help).toContain("--help");
    expect(help).toContain("-h");
  });

  it("includes Flags: section", () => {
    const cmd = createCommand({ name: "foo" });
    expect(formatHelp(cmd)).toContain("Flags:");
  });

  it("shows flag name and description", () => {
    const cmd = createCommand({ name: "foo", flags: { verbose: { type: "boolean", short: "v", description: "Enable verbose output" } } });
    const help = formatHelp(cmd);
    expect(help).toContain("--verbose");
    expect(help).toContain("-v");
    expect(help).toContain("Enable verbose output");
  });

  it("marks required string flags with (required)", () => {
    const cmd = createCommand({ name: "foo", flags: { output: { type: "string", required: true, description: "Output file" } } });
    expect(formatHelp(cmd)).toContain("(required)");
  });

  it("does not mark optional string flags with (required)", () => {
    const cmd = createCommand({ name: "foo", flags: { output: { type: "string", description: "Output file" } } });
    expect(formatHelp(cmd)).not.toContain("(required)");
  });

  it("lists subcommands alphabetically", () => {
    const root = createCommand({ name: "root" });
    addCommand(root, createCommand({ name: "zebra", description: "Z" }));
    addCommand(root, createCommand({ name: "apple", description: "A" }));
    addCommand(root, createCommand({ name: "mango", description: "M" }));
    const help = formatHelp(root);
    expect(help.indexOf("apple")).toBeLessThan(help.indexOf("mango"));
    expect(help.indexOf("mango")).toBeLessThan(help.indexOf("zebra"));
  });

  it("includes Available Commands section when subcommands exist", () => {
    const root = createCommand({ name: "root" });
    addCommand(root, createCommand({ name: "sub", description: "A subcommand" }));
    expect(formatHelp(root)).toContain("Available Commands:");
    expect(formatHelp(root)).toContain("sub");
  });

  it("includes Use ... --help hint when subcommands exist", () => {
    const root = createCommand({ name: "mytool" });
    addCommand(root, createCommand({ name: "sub" }));
    const help = formatHelp(root);
    expect(help).toContain('Use "mytool [command] --help"');
  });

  it("omits Use hint for leaf commands", () => {
    const cmd = createCommand({ name: "leaf" });
    expect(formatHelp(cmd)).not.toContain("Use ");
  });

  it("aligns all flag descriptions at the same column", () => {
    const cmd = createCommand({
      name: "foo",
      flags: {
        verbose: { type: "boolean", short: "v", description: "Verbose" },
        output: { type: "string", description: "Output file" },
        x: { type: "boolean", short: "x", description: "Extra" },
      },
    });
    const help = formatHelp(cmd);
    const lines = help.split("\n").filter((l) => l.includes("--"));
    // All description columns should start at the same index
    const descCols = lines.map((l) => {
      const match = l.match(/--\S+(\s+)/);
      return match ? l.indexOf(match[0]) + match[0].length : -1;
    });
    const unique = [...new Set(descCols)];
    expect(unique).toHaveLength(1);
  });
});
