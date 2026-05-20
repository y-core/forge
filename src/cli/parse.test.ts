import { describe, expect, it } from "bun:test";
import { addCommand, createCommand } from "./command";
import { CliError } from "./errors";
import { collectFlags, parseArgs } from "./parse";

describe("parseArgs()", () => {
  describe("boolean flags", () => {
    it("sets flag to true when --flag present", () => {
      const { flags } = parseArgs(["--verbose"], { verbose: { type: "boolean" } });
      expect(flags.verbose).toBe(true);
    });

    it("defaults to false when absent", () => {
      const { flags } = parseArgs([], { verbose: { type: "boolean" } });
      expect(flags.verbose).toBe(false);
    });

    it("parses short -v form", () => {
      const { flags } = parseArgs(["-v"], { verbose: { type: "boolean", short: "v" } });
      expect(flags.verbose).toBe(true);
    });

    it("parses multiple boolean flags", () => {
      const { flags } = parseArgs(["--foo", "--bar"], {
        foo: { type: "boolean" },
        bar: { type: "boolean" },
        baz: { type: "boolean" },
      });
      expect(flags.foo).toBe(true);
      expect(flags.bar).toBe(true);
      expect(flags.baz).toBe(false);
    });
  });

  describe("string flags", () => {
    it("parses --flag value", () => {
      const { flags } = parseArgs(["--output", "file.txt"], { output: { type: "string" } });
      expect(flags.output).toBe("file.txt");
    });

    it("parses --flag=value", () => {
      const { flags } = parseArgs(["--output=file.txt"], { output: { type: "string" } });
      expect(flags.output).toBe("file.txt");
    });

    it("parses -f value", () => {
      const { flags } = parseArgs(["-f", "file.txt"], { output: { type: "string", short: "f" } });
      expect(flags.output).toBe("file.txt");
    });

    it("parses -f=value", () => {
      const { flags } = parseArgs(["-f=file.txt"], { output: { type: "string", short: "f" } });
      expect(flags.output).toBe("file.txt");
    });

    it("applies string default when flag absent", () => {
      const { flags } = parseArgs([], { format: { type: "string", default: "table" } });
      expect(flags.format).toBe("table");
    });

    it("returns undefined for optional string flag absent", () => {
      const { flags } = parseArgs([], { output: { type: "string" } });
      expect(flags.output).toBeUndefined();
    });

    it("throws missing-value when required flag absent", () => {
      expect(() => parseArgs([], { output: { type: "string", required: true } })).toThrow(CliError);
    });

    it("sets missing-value kind on required error", () => {
      try {
        parseArgs([], { output: { type: "string", required: true } });
      } catch (e) {
        expect(e instanceof CliError && e.kind).toBe("missing-value");
      }
    });

    it("throws missing-value when no next token for string flag", () => {
      expect(() => parseArgs(["--output"], { output: { type: "string" } })).toThrow(CliError);
    });

    it("throws missing-value when next token looks like a flag", () => {
      expect(() =>
        parseArgs(["--output", "--other"], { output: { type: "string" } }),
      ).toThrow(CliError);
    });
  });

  describe("positional args", () => {
    it("collects positional args mixed with flags", () => {
      const { args } = parseArgs(["foo", "--verbose", "bar"], { verbose: { type: "boolean" } });
      expect(args).toEqual(["foo", "bar"]);
    });

    it("treats everything after -- as positionals", () => {
      const { args, flags } = parseArgs(["--verbose", "--", "--not-a-flag", "arg"], {
        verbose: { type: "boolean" },
      });
      expect(flags.verbose).toBe(true);
      expect(args).toEqual(["--not-a-flag", "arg"]);
    });

    it("treats bare - as a positional", () => {
      const { args } = parseArgs(["-"], {});
      expect(args).toEqual(["-"]);
    });
  });

  describe("errors", () => {
    it("throws unknown-flag for unrecognised --flag", () => {
      try {
        parseArgs(["--unknown"], {});
      } catch (e) {
        expect(e instanceof CliError && e.kind).toBe("unknown-flag");
      }
    });

    it("throws unknown-flag for unrecognised -x short", () => {
      try {
        parseArgs(["-z"], {});
      } catch (e) {
        expect(e instanceof CliError && e.kind).toBe("unknown-flag");
      }
    });
  });
});

describe("collectFlags()", () => {
  it("returns all own flags for a root command", () => {
    const cmd = createCommand({
      name: "root",
      flags: { verbose: { type: "boolean" }, output: { type: "string" } },
    });
    const flags = collectFlags(cmd);
    expect(flags).toHaveProperty("verbose");
    expect(flags).toHaveProperty("output");
  });

  it("includes persistent ancestor flags for child", () => {
    const parent = createCommand({
      name: "root",
      flags: {
        debug: { type: "boolean", persistent: true },
        internal: { type: "boolean" },
      },
    });
    const child = createCommand({ name: "sub", flags: { verbose: { type: "boolean" } } });
    addCommand(parent, child);

    const flags = collectFlags(child);
    expect(flags).toHaveProperty("debug");
    expect(flags).not.toHaveProperty("internal");
    expect(flags).toHaveProperty("verbose");
  });

  it("excludes non-persistent ancestor flags", () => {
    const parent = createCommand({
      name: "root",
      flags: { secret: { type: "string" } },
    });
    const child = createCommand({ name: "sub" });
    addCommand(parent, child);

    const flags = collectFlags(child);
    expect(flags).not.toHaveProperty("secret");
  });

  it("child flag overrides ancestor flag of same name", () => {
    const parent = createCommand({
      name: "root",
      flags: { format: { type: "string", persistent: true, default: "text" } },
    });
    const child = createCommand({
      name: "sub",
      flags: { format: { type: "string", default: "json" } },
    });
    addCommand(parent, child);

    const flags = collectFlags(child);
    expect(flags.format).toEqual({ type: "string", default: "json" });
  });

  it("propagates persistent flags through multiple levels", () => {
    const root = createCommand({
      name: "root",
      flags: { debug: { type: "boolean", persistent: true } },
    });
    const mid = createCommand({ name: "mid" });
    const leaf = createCommand({ name: "leaf" });
    addCommand(root, mid);
    addCommand(mid, leaf);

    const flags = collectFlags(leaf);
    expect(flags).toHaveProperty("debug");
  });
});
