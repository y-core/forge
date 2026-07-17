import { renderToString } from "../jsx/render-to-string";

/**
 * Renders a JSX element to its HTML string for assertions. Wraps `renderToString`
 * and coerces the result to a plain `String`, so tests can `expect(await render(<C/>)).toBe(...)`.
 *
 * @example
 * ```typescript
 * expect(await render(<Button label="Save" />)).toBe('<button type="button">Save</button>');
 * ```
 * @public
 */
export async function render(element: unknown): Promise<string> {
  return String(await renderToString(element));
}
