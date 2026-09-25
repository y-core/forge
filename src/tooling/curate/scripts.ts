import { CliError } from "../cli/errors";

const SCRIPTS_OPEN = /^\s*"scripts"\s*:\s*\{\s*$/;
const ENTRY_KEY = /^\s*("(?:[^"\\]|\\.)*")\s*:/;

/** `package.json`'s text without the named scripts, edited line by line so the formatter's layout survives; refuses a layout whose edit would not be exactly that. @internal */
export function trimScripts(text: string, names: readonly string[]): string {
  const lines = text.split("\n");
  const open = lines.findIndex((line) => SCRIPTS_OPEN.test(line));
  const close = open === -1 ? -1 : lines.findIndex((line, index) => index > open && /^\s*\}/.test(line));
  const entries = close === -1 ? [] : lines.slice(open + 1, close);
  const remaining = entries.filter((line) => {
    const key = ENTRY_KEY.exec(line)?.[1];
    return key === undefined || !names.includes(JSON.parse(key) as string);
  });
  const last = remaining.length - 1;
  if (last >= 0) remaining[last] = (remaining[last] ?? "").replace(/,(\s*)$/, "$1");
  const edited = close === -1 ? text : [...lines.slice(0, open + 1), ...remaining, ...lines.slice(close)].join("\n");

  const expected = JSON.parse(text) as { scripts?: Record<string, string> };
  for (const name of names) delete expected.scripts?.[name];
  let actual: unknown;
  try {
    actual = JSON.parse(edited);
  } catch {
    actual = undefined;
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new CliError("invalid-args", "package.json's scripts are not one entry per line — forge curate removes a script by removing its line");
  }
  return edited;
}
