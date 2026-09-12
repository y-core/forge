import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";

import { confirm } from "./confirm";
import { CliError } from "./errors";

const consequence = "The old values cannot be recovered.";

function streams(answer: string) {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean };
  input.isTTY = true;
  const output = new PassThrough();
  input.end(`${answer}\n`);
  return { input, output };
}

describe("confirm()", () => {
  it("returns at once under --yes, printing nothing", async () => {
    const lines: string[] = [];
    await confirm({ what: "the ledger", consequence, yes: true, interactive: false, print: (line) => lines.push(line) });
    expect(lines).toEqual([]);
  });

  it("refuses without a terminal, naming the action and how to say yes deliberately", async () => {
    const attempt = confirm({ verb: "rotate", what: "1 secret on local", detail: "SESSION_SECRET", consequence, interactive: false });
    await expect(attempt).rejects.toThrow(
      "Refusing to rotate 1 secret on local without a terminal to confirm at: SESSION_SECRET.\nThe old values cannot be recovered. Pass --yes to say so deliberately.",
    );
    await expect(attempt).rejects.toBeInstanceOf(CliError);
  });

  it("proceeds on y, after printing what it is about to do", async () => {
    const lines: string[] = [];
    const { input, output } = streams("y");
    await confirm({ verb: "reset", what: "app-db (local)", consequence, input, output, print: (line) => lines.push(line) });
    expect(lines).toEqual(["About to reset app-db (local)", consequence]);
  });

  it("cancels with the caller's message on anything but y", async () => {
    const { input, output } = streams("no");
    await expect(confirm({ what: "x", consequence, input, output, cancelMessage: "Reset cancelled.", print: () => {} })).rejects.toThrow(
      "Reset cancelled.",
    );
  });

  it("cancels with a default message when the caller gave none", async () => {
    const { input, output } = streams("");
    await expect(confirm({ what: "x", consequence, input, output, print: () => {} })).rejects.toThrow("Cancelled; nothing was changed.");
  });
});
