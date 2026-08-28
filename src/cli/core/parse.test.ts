import { describe, expect, it } from "bun:test";
import { addCommand, createCommand } from "./command";
import { CliError } from "./errors";
import { collectFlags, parseArgs, splitList } from "./parse";

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
      const { flags } = parseArgs(["--foo", "--bar"], { foo: { type: "boolean" }, bar: { type: "boolean" }, baz: { type: "boolean" } });
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
      expect(() => parseArgs(["--output", "--other"], { output: { type: "string" } })).toThrow(CliError);
    });
  });

  describe("positional args", () => {
    it("collects positional args mixed with flags", () => {
      const { args } = parseArgs(["foo", "--verbose", "bar"], { verbose: { type: "boolean" } });
      expect(args).toEqual(["foo", "bar"]);
    });

    it("treats everything after -- as positionals", () => {
      const { args, flags } = parseArgs(["--verbose", "--", "--not-a-flag", "arg"], { verbose: { type: "boolean" } });
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
    const cmd = createCommand({ name: "root", flags: { verbose: { type: "boolean" }, output: { type: "string" } } });
    const flags = collectFlags(cmd);
    expect(flags).toHaveProperty("verbose");
    expect(flags).toHaveProperty("output");
  });

  it("includes persistent ancestor flags for child", () => {
    const parent = createCommand({ name: "root", flags: { debug: { type: "boolean", persistent: true }, internal: { type: "boolean" } } });
    const child = createCommand({ name: "sub", flags: { verbose: { type: "boolean" } } });
    addCommand(parent, child);

    const flags = collectFlags(child);
    expect(flags).toHaveProperty("debug");
    expect(flags).not.toHaveProperty("internal");
    expect(flags).toHaveProperty("verbose");
  });

  it("excludes non-persistent ancestor flags", () => {
    const parent = createCommand({ name: "root", flags: { secret: { type: "string" } } });
    const child = createCommand({ name: "sub" });
    addCommand(parent, child);

    const flags = collectFlags(child);
    expect(flags).not.toHaveProperty("secret");
  });

  it("child flag overrides ancestor flag of same name", () => {
    const parent = createCommand({ name: "root", flags: { format: { type: "string", persistent: true, default: "text" } } });
    const child = createCommand({ name: "sub", flags: { format: { type: "string", default: "json" } } });
    addCommand(parent, child);

    const flags = collectFlags(child);
    expect(flags.format).toEqual({ type: "string", default: "json" });
  });

  it("propagates persistent flags through multiple levels", () => {
    const root = createCommand({ name: "root", flags: { debug: { type: "boolean", persistent: true } } });
    const mid = createCommand({ name: "mid" });
    const leaf = createCommand({ name: "leaf" });
    addCommand(root, mid);
    addCommand(mid, leaf);

    const flags = collectFlags(leaf);
    expect(flags).toHaveProperty("debug");
  });
});

describe("splitList()", () => {
  it("is empty for nothing", () => {
    expect(splitList(undefined)).toEqual([]);
  });

  it("splits one comma-joined string", () => {
    expect(splitList("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("splits each element of a list", () => {
    expect(splitList(["a,b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("trims and drops empties", () => {
    expect(splitList([" a , ", "", " b"])).toEqual(["a", "b"]);
  });
});

describe("repeatable flags", () => {
  const repeatable = { only: { type: "string" as const, multiple: true as const } };

  it("collects every occurrence, where the last used to be kept in silence", () => {
    expect(parseArgs(["--only", "a", "--only", "b", "--only", "c"], repeatable).flags.only).toEqual(["a", "b", "c"]);
  });

  it("collects an inline value alongside a separated one", () => {
    expect(parseArgs(["--only=a", "--only", "b"], repeatable).flags.only).toEqual(["a", "b"]);
  });

  it("is an empty list when the flag is absent", () => {
    expect(parseArgs([], repeatable).flags.only).toEqual([]);
  });

  it("throws on a repeat of a flag that is not repeatable, rather than dropping the first", () => {
    expect(() => parseArgs(["--config", "a", "--config", "b"], { config: { type: "string" as const } })).toThrow(
      /--config was given more than once.*silently drop "a"/,
    );
  });
});

describe("prototype-named flags", () => {
  it("round-trips --toString as a plain value", () => {
    expect(parseArgs(["--toString", "x"], { toString: { type: "string" as const } }).flags.toString).toBe("x");
  });

  it("round-trips --__proto__ as an own property, without moving any prototype", () => {
    // Written with a computed key: a `{ __proto__: … }` literal would set the prototype of the
    // definition table itself, which is the very mistake the Map inside `parseArgs` avoids.
    const { flags } = parseArgs(["--__proto__", "polluted"], { ["__proto__"]: { type: "string" as const } });
    expect(Object.getOwnPropertyDescriptor(flags, "__proto__")?.value).toBe("polluted");
    expect(Object.getPrototypeOf(flags)).toBe(Object.prototype);
  });
});

describe("values that look like flags", () => {
  const numeric = { limit: { type: "string" as const } };

  it("takes a negative number as a value", () => {
    expect(parseArgs(["--limit", "-5"], numeric).flags.limit).toBe("-5");
  });

  it("takes a negative decimal as a value", () => {
    expect(parseArgs(["--limit", "-1.5"], numeric).flags.limit).toBe("-1.5");
  });

  it("still refuses to swallow the next flag as a value", () => {
    expect(() => parseArgs(["--limit", "--commit"], { ...numeric, commit: { type: "boolean" as const } })).toThrow(/--limit requires a value/);
  });
});

describe("short clusters", () => {
  const flags = { all: { type: "boolean" as const, short: "a" }, verbose: { type: "boolean" as const, short: "v" } };

  it("accepts a cluster of boolean shorts", () => {
    expect(parseArgs(["-av"], flags).flags).toEqual({ all: true, verbose: true });
  });

  it("gives the trailing member of a cluster its inline value", () => {
    expect(parseArgs(["-ac=path"], { ...flags, config: { type: "string" as const, short: "c" } }).flags.config).toBe("path");
  });
});

describe("unknown flags", () => {
  const flags = { commit: { type: "boolean" as const }, config: { type: "string" as const } };

  it("names a near miss", () => {
    expect(() => parseArgs(["--comit"], flags)).toThrow("Unknown flag: --comit. Did you mean --commit?");
  });

  it("offers nothing when nothing is close", () => {
    expect(() => parseArgs(["--zzzzzz"], flags)).toThrow("Unknown flag: --zzzzzz.");
  });
});
