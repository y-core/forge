import { describe, expect, it } from "bun:test";
import { addCommand, createCommand } from "./command";

describe("createCommand()", () => {
  it("sets name and description", () => {
    const cmd = createCommand({ name: "foo", description: "Foo command" });
    expect(cmd.name).toBe("foo");
    expect(cmd.description).toBe("Foo command");
  });

  it("defaults description to empty string", () => {
    const cmd = createCommand({ name: "foo" });
    expect(cmd.description).toBe("");
  });

  it("defaults flags to empty object", () => {
    const cmd = createCommand({ name: "foo" });
    expect(cmd.flags).toEqual({});
  });

  it("defaults args to { kind: 'none' }", () => {
    const cmd = createCommand({ name: "foo" });
    expect(cmd.args).toEqual({ kind: "none" });
  });

  it("defaults commands to empty array", () => {
    const cmd = createCommand({ name: "foo" });
    expect(cmd.commands).toEqual([]);
  });

  it("leaves parent undefined", () => {
    const cmd = createCommand({ name: "foo" });
    expect(cmd.parent).toBeUndefined();
  });

  it("preserves flags, args, and run from config", () => {
    const run = () => {};
    const cmd = createCommand({
      name: "foo",
      flags: { verbose: { type: "boolean", short: "v", description: "Verbose" } },
      args: { kind: "min", min: 1 },
      run,
    });
    expect(cmd.flags).toHaveProperty("verbose");
    expect(cmd.args).toEqual({ kind: "min", min: 1 });
    expect(cmd.run).toBe(run);
  });
});

describe("addCommand()", () => {
  it("appends child to parent.commands", () => {
    const parent = createCommand({ name: "root" });
    const child = createCommand({ name: "sub" });
    addCommand(parent, child);
    expect(parent.commands).toHaveLength(1);
    expect(parent.commands[0]).toBe(child);
  });

  it("sets child.parent to parent", () => {
    const parent = createCommand({ name: "root" });
    const child = createCommand({ name: "sub" });
    addCommand(parent, child);
    expect(child.parent).toBe(parent);
  });

  it("throws on duplicate command name", () => {
    const parent = createCommand({ name: "root" });
    addCommand(parent, createCommand({ name: "sub" }));
    expect(() => addCommand(parent, createCommand({ name: "sub" }))).toThrow('Duplicate command name: "sub"');
  });

  it("allows multiple distinct children", () => {
    const parent = createCommand({ name: "root" });
    addCommand(parent, createCommand({ name: "a" }));
    addCommand(parent, createCommand({ name: "b" }));
    addCommand(parent, createCommand({ name: "c" }));
    expect(parent.commands).toHaveLength(3);
  });
});
