import { describe, expect, it } from "bun:test";
import { commandAttrs } from "./command-attrs";

describe("commandAttrs", () => {
  it("prefixes the action with -- and passes the commandfor id through", () => {
    expect(commandAttrs("selectTool", "chrome-root")).toEqual({ command: "--selectTool", commandfor: "chrome-root" });
  });

  it("strips a leading # from the commandfor target", () => {
    expect(commandAttrs("undo", "#chrome-root")).toEqual({ command: "--undo", commandfor: "chrome-root" });
  });

  it("leaves a bare id untouched", () => {
    expect(commandAttrs("save", "sink")).toEqual({ command: "--save", commandfor: "sink" });
  });

  it("only strips the first #, keeping the rest of the id", () => {
    expect(commandAttrs("x", "#a#b")).toEqual({ command: "--x", commandfor: "a#b" });
  });
});
