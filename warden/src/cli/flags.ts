/** The `--root` every verb that reads a repository declares, shared so two spellings cannot drift. @internal */
export const ROOT_FLAG = { type: "string", description: "Repository root (default: derived from warden's install path)" } as const;

/** The `--kind` every verb that reads the canon declares, on the same terms as `ROOT_FLAG`. @internal */
export const KIND_FLAG = { type: "string", description: "Select the canon tree (libs|apps), overriding package.json's `warden.kind`" } as const;
