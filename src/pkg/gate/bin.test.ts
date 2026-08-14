import { describe, expect, it } from "bun:test";
import { createReleaseBinCommand } from "../release/release";
import { createGateBinCommand, createGateCommand, DEFAULT_STEPS_CONFIG } from "./command";

const GATE = createGateBinCommand();
const RELEASE = createReleaseBinCommand();

describe("createGateBinCommand()", () => {
  it("is named for the bin it backs, since the name is what --help prints", () => {
    expect(GATE.name).toBe("forge-verify");
  });

  it("keeps every flag the handed-a-table command takes, so the bin is not a lesser gate", () => {
    const inner = Object.keys(createGateCommand({ cwd: "/nowhere", steps: [{ label: "x", tail: 1, cmd: ["x"] }] }).flags);

    expect(inner.every((flag) => Object.hasOwn(GATE.flags, flag))).toBe(true);
  });

  it("adds exactly the two flags a config-loading bin needs, and no more", () => {
    const inner = Object.keys(createGateCommand({ cwd: "/nowhere", steps: [{ label: "x", tail: 1, cmd: ["x"] }] }).flags);

    expect(Object.keys(GATE.flags).filter((flag) => !inner.includes(flag))).toEqual(["config", "root"]);
  });

  it("takes no positional argument, so a stray word is refused rather than read as a step", () => {
    expect(GATE.args).toEqual({ kind: "none" });
  });

  it("names the default config path in --config's description, so --help answers where it looks", () => {
    expect(GATE.flags.config.description).toContain(DEFAULT_STEPS_CONFIG);
  });
});

describe("createReleaseBinCommand()", () => {
  it("is named for the bin it backs", () => {
    expect(RELEASE.name).toBe("forge-release");
  });

  it("keeps the optional explicit-version argument the release command accepts", () => {
    expect(RELEASE.args).toEqual({ kind: "range", min: 0, max: 1 });
  });

  it("carries the release flags alongside the two config-loading ones", () => {
    expect(Object.keys(RELEASE.flags).sort()).toEqual(["allow-dirty", "allow-empty-changelog", "config", "dry", "root"]);
  });

  it("keeps --dry's short form, which is what a release is most often invoked with", () => {
    expect(RELEASE.flags.dry.short).toBe("n");
  });
});

describe("the two bins agree on how a config module is named", () => {
  it("spells the flags identically, so one habit serves both", () => {
    expect(GATE.flags.config.type).toBe(RELEASE.flags.config.type);
    expect(GATE.flags.root.type).toBe(RELEASE.flags.root.type);
  });

  it("defaults both config paths into the same directory", () => {
    expect(DEFAULT_STEPS_CONFIG.startsWith("config/")).toBe(true);
  });
});
