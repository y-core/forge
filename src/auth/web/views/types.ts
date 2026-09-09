/** What every auth view accepts so a host page can place it. @public */
export interface AuthViewChrome {
  /** Composed onto the root after the view's own classes, so the caller's width or margin wins. */
  readonly class?: string | undefined;
  /** Heading level, from the view's place in the host document. Never from its size. Defaults to `1`. */
  readonly level?: 1 | 2 | 3 | 4 | 5 | 6 | undefined;
}
