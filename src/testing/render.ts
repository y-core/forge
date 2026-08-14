import { renderToString } from "../jsx/render-to-string";

/** Renders a JSX element to its HTML string for assertions. @public */
export async function render(element: unknown): Promise<string> {
  return String(await renderToString(element));
}
