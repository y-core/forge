/** One binding flavour: where it lives in config, how its name is read, and its TS type. @internal */
export interface BindingDef {
  configKey: string;
  nameField: "binding" | "name";
  tsType: string;
  shape: "list" | "object";
  label: string;
  message: (n: string) => string;
}

/** One emitted schema entry: a binding/var key and its valibot expression. @internal */
export interface Entry {
  name: string;
  expr: string;
}

/** Host policy layered over the generated schema. @public */
export interface GenOptions {
  optional: Set<string>;
  refinements: Record<string, { minLength?: number }>;
  bindingCheck: string;
}

/** Runs a command to completion and answers how it exited — the seam the generator's formatter takes, so a test substitutes it rather than the module. @internal */
export type SpawnSync = (command: string, args: string[], options: { stdio: "inherit"; cwd: string }) => { status: number | null };
