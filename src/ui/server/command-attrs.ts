/** Builds Invoker Command attributes routing a custom `--action` into a resumable scope. @public */
export function commandAttrs<A extends string = string>(action: A, commandfor: string): { command: string; commandfor: string } {
  const id = commandfor.startsWith("#") ? commandfor.slice(1) : commandfor;
  return { command: `--${action}`, commandfor: id };
}
