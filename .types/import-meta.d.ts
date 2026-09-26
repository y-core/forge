// Merged here because `lib.dom.d.ts` gives `ImportMeta` only `url` and `resolve`, and `"types": []`
// keeps any runtime's own declarations out.

interface ImportMeta {
  /** True only in the module the process was launched with. */
  readonly main: boolean;
  /** The directory holding this module, as a filesystem path. */
  readonly dir: string;
}
