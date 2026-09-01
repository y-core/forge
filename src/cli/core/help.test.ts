import { describe, expect, it } from "bun:test";

import { createColorize } from "../term/color";
import { addCommand, createCommand } from "./command";
import { formatHelp, formatUsage } from "./help";

describe("formatUsage()", () => {
  it("names a leaf command and its flags", () => {
    expect(formatUsage(createCommand({ name: "mytool" }))).toBe("Usage:\n  mytool [flags]");
  });

  it("spells out the full path of a nested subcommand", () => {
    const root = createCommand({ name: "root" });
    const sub = createCommand({ name: "sub" });
    addCommand(root, sub);
    expect(formatUsage(sub)).toBe("Usage:\n  root sub [flags]");
  });

  it("announces [command] when subcommands exist", () => {
    const root = createCommand({ name: "root" });
    addCommand(root, createCommand({ name: "sub" }));
    expect(formatUsage(root)).toBe("Usage:\n  root [command] [flags]");
  });

  it("announces [args] when the args validator is not none", () => {
    expect(formatUsage(createCommand({ name: "foo", args: { kind: "min", min: 1 } }))).toBe("Usage:\n  foo [flags] [args]");
  });
});

describe("formatHelp()", () => {
  it("renders a bare command as description, usage and the one flag every command has", () => {
    expect(formatHelp(createCommand({ name: "foo", description: "Foo does things" })).split("\n")).toEqual([
      "Foo does things",
      "",
      "Usage:",
      "  foo [flags]",
      "",
      "Flags:",
      "  -h, --help  Show help for this command",
    ]);
  });

  it("omits the description block when the command has none", () => {
    expect(formatHelp(createCommand({ name: "foo" })).split("\n")[0]).toBe("Usage:");
  });

  it("lists subcommands alphabetically, aligned, under the usage block", () => {
    const root = createCommand({ name: "mytool" });
    addCommand(root, createCommand({ name: "zebra", description: "Z things" }));
    addCommand(root, createCommand({ name: "apple", description: "A things" }));
    addCommand(root, createCommand({ name: "middle", description: "M things" }));
    expect(formatHelp(root).split("\n")).toEqual([
      "Usage:",
      "  mytool [command] [flags]",
      "",
      "Available Commands:",
      "  apple   A things",
      "  middle  M things",
      "  zebra   Z things",
      "",
      "Flags:",
      "  -h, --help  Show help for this command",
      "",
      'Use "mytool [command] --help" for more information.',
    ]);
  });

  it("aligns every description at one column, whatever the term beside it", () => {
    const cmd = createCommand({
      name: "foo",
      flags: {
        verbose: { type: "boolean", short: "v", description: "Verbose" },
        output: { type: "string", required: true, description: "Output file" },
        mode: { type: "string", default: "fast", description: "How much to run" },
        x: { type: "boolean", description: "Extra" },
      },
    });
    expect(formatHelp(cmd).split("\n").slice(-5)).toEqual([
      "  -v, --verbose          Verbose",
      "      --output <string>  Output file (required)",
      "      --mode <string>    How much to run (default: fast)",
      "      --x                Extra",
      "  -h, --help             Show help for this command",
    ]);
  });

  it("shows an inherited persistent flag, which the parser accepts and the help used to hide", () => {
    const root = createCommand({ name: "root", flags: { config: { type: "string", short: "c", description: "Config path", persistent: true } } });
    const sub = createCommand({ name: "sub", flags: { force: { type: "boolean", description: "Force it" } } });
    addCommand(root, sub);
    expect(formatHelp(sub).split("\n").slice(-3)).toEqual([
      "  -c, --config <string>  Config path",
      "      --force            Force it",
      "  -h, --help             Show help for this command",
    ]);
  });

  it("does not show a non-persistent flag of the parent", () => {
    const root = createCommand({ name: "root", flags: { quiet: { type: "boolean", description: "Say less" } } });
    const sub = createCommand({ name: "sub" });
    addCommand(root, sub);
    expect(formatHelp(sub)).not.toContain("--quiet");
  });

  it("wraps a long description at the given width rather than overhanging it", () => {
    const cmd = createCommand({
      name: "foo",
      flags: { only: { type: "string", description: "Run only these steps, named by their labels in the table" } },
    });
    expect(formatHelp(cmd, { width: 50 }).split("\n").slice(-4)).toEqual([
      "      --only <string>  Run only these steps, named",
      "                       by their labels in the",
      "                       table",
      "  -h, --help           Show help for this command",
    ]);
  });

  it("styles the section headings when given a styler", () => {
    const bold = createColorize(1).bold;
    expect(formatHelp(createCommand({ name: "foo" }), { style: createColorize(1) })).toContain(bold("Flags:"));
  });

  it("emits no escape sequences by default", () => {
    const root = createCommand({ name: "root" });
    addCommand(root, createCommand({ name: "sub", description: "A subcommand" }));
    expect(formatHelp(root)).toBe(createColorize(0).strip(formatHelp(root)));
  });
});
