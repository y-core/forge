import process from "node:process";

/** Columns assumed when nothing on the stream says otherwise. @public */
export const DEFAULT_WIDTH = 80;

/** How many columns are available on `stream`, or `fallback` when it is not a terminal. @public */
export function terminalWidth(stream: { readonly columns?: number } = process.stdout, fallback = DEFAULT_WIDTH): number {
  const columns = stream.columns;
  return typeof columns === "number" && columns > 0 ? columns : fallback;
}
