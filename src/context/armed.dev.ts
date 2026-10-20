declare const __FORGE_DEV__: boolean | undefined;

/** Whether the build that bundled this module defined `__FORGE_DEV__` as `true`. @internal */
export function isDevBuildArmed(): boolean {
  return typeof __FORGE_DEV__ !== "undefined" && __FORGE_DEV__ === true;
}

/** A function that answers with `relaxed` while `isArmed` holds, and with `strict` otherwise. @internal */
export function whenArmed<A extends unknown[], R>(
  isArmed: () => boolean,
  relaxed: (...args: A) => R,
  strict: (...args: A) => R,
): (...args: A) => R {
  return (...args) => (isArmed() ? relaxed(...args) : strict(...args));
}
