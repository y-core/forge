/** Whether the workerd runtime is installed, which is what a specs-in-workerd step actually needs. @public */
export function hasWorkerd(): boolean {
  try {
    // `wrangler` is what resolves the platform-specific `@cloudflare/workerd-*` package, so its own
    // presence is the honest probe: a resolvable wrangler brings a runnable workerd with it.
    import.meta.resolve("wrangler");
    return true;
  } catch {
    return false;
  }
}
