import process from "node:process";

/** Columns assumed when nothing on the stream says otherwise. @public */
export const DEFAULT_WIDTH = 80;

/**
 * How many columns are available on `stream`.
 *
 * Takes the stream rather than reading `process.stdout` itself, so the caller decides whether it
 * is laying out for stdout or for stderr — a redirected stdout and an attached stderr do not have
 * the same width, and one number cannot express both. A stream with no `columns` is not a
 * terminal, and gets `fallback`.
 * @public
 */
export function terminalWidth(stream: { readonly columns?: number } = process.stdout, fallback = DEFAULT_WIDTH): number {
  const columns = stream.columns;
  return typeof columns === "number" && columns > 0 ? columns : fallback;
}
