// `import.meta.main` — the entry-point discriminator every script in `scripts/` guards its
// `main()` with. Declared here by interface merging because `lib.dom.d.ts` gives `ImportMeta` only
// `url` and `resolve`, and `"types": []` keeps any runtime's own declarations out.

interface ImportMeta {
  /** True only in the module the process was launched with. False in every module reached by an
   *  `import`, which is what lets a test import a validator without running it. */
  readonly main: boolean;
}
