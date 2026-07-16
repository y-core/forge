/** Build native Invoker Command attributes (`command` + `commandfor`) that route a custom
 * `--action` into the resumable scope handler table via the `CommandEvent` bridge in
 * `ui/client/resume.ts`. A sibling to `scopeAttrs`: both dispatch into the same `on` map, but
 * `commandAttrs` covers *activation* (a `<button>` press) while `scopeAttrs` covers stateful
 * `input`/`change`/`submit` wiring. Generic over the same action union `A` as `scopeAttrs`, so a
 * typo is a compile error and client + server share one action namespace.
 *
 * `commandfor` names an element **id** — pass a bare `id` or a `#id` (the leading `#` is stripped).
 * For custom commands with no popover target, point it at an eager scope root's id (the sink).
 *
 * `<button {...commandAttrs<ChromeAction>("selectTool", "chrome-root")} data-tool='line' />`
 * @public */
export function commandAttrs<A extends string = string>(action: A, commandfor: string): { command: string; commandfor: string } {
  const id = commandfor.startsWith("#") ? commandfor.slice(1) : commandfor;
  return { command: `--${action}`, commandfor: id };
}
