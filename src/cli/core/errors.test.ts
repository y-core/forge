import { describe, expect, it } from "bun:test";
import { CliError, formatError } from "./errors";
import type { CliErrorKind } from "./types";

describe("CliError — constructor", () => {
  it("sets name to CliError", () => {
    const err = new CliError("unknown-flag", "Unknown flag: --verbose");
    expect(err.name).toBe("CliError");
  });

  it("sets the message property", () => {
    const err = new CliError("unknown-flag", "Unknown flag: --verbose");
    expect(err.message).toBe("Unknown flag: --verbose");
  });

  it("sets the kind property", () => {
    const err = new CliError("unknown-flag", "Unknown flag: --verbose");
    expect(err.kind).toBe("unknown-flag");
  });

  it("is an instance of Error", () => {
    const err = new CliError("unknown-flag", "Unknown flag: --verbose");
    expect(err instanceof Error).toBe(true);
  });

  it("is an instance of CliError", () => {
    const err = new CliError("unknown-flag", "Unknown flag: --verbose");
    expect(err instanceof CliError).toBe(true);
  });
});

describe("CliError — kind round-trips", () => {
  const cases: Array<{ kind: CliErrorKind; message: string }> = [
    { kind: "unknown-flag", message: "Unknown flag: --verbose" },
    { kind: "missing-value", message: "Missing value for --output" },
    { kind: "invalid-args", message: "Expected exactly 1 argument" },
    { kind: "missing-command", message: "No command provided" },
  ];

  for (const { kind, message } of cases) {
    it(`round-trips kind "${kind}"`, () => {
      const err = new CliError(kind, message);
      expect(err.kind).toBe(kind);
      expect(err.message).toBe(message);
    });
  }
});

describe("formatError", () => {
  it("returns 'Error: {message}' for a CliError", () => {
    const err = new CliError("missing-value", "Missing value for --output");
    expect(formatError(err)).toBe("Error: Missing value for --output");
  });

  it("formats each kind correctly", () => {
    expect(formatError(new CliError("unknown-flag", "Unknown flag: --foo"))).toBe("Error: Unknown flag: --foo");
    expect(formatError(new CliError("invalid-args", "Too many arguments"))).toBe("Error: Too many arguments");
    expect(formatError(new CliError("missing-command", "No command provided"))).toBe("Error: No command provided");
  });
});
