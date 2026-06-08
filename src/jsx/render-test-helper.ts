import { renderToString } from "./render-to-string";

export async function render(element: unknown): Promise<string> {
  return String(await renderToString(element));
}
