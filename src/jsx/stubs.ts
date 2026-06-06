import type { Context, ErrorBoundaryProps, JSXElement, SuspenseProps } from "./types";

// No-op stubs for API parity with common JSX runtimes. These are unused in SSR — Islands/signals
// arrive via the islands seam. Exported so consumers porting from other JSX libraries can import
// these names without errors.

export function memo<T>(component: T): T {
  return component;
}

export function createContext<T>(defaultValue: T): Context<T> {
  return { defaultValue };
}

export function useContext<T>(ctx: Context<T>): T {
  return ctx.defaultValue;
}

export function Suspense(_: SuspenseProps): JSXElement | null {
  return null;
}

export function ErrorBoundary(_: ErrorBoundaryProps): JSXElement | null {
  return null;
}
