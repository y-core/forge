/** A flat map of `hx-*` attributes. @public */
export type HxAttrs = Record<string, string>;

/** The htmx attributes `hxAttrs` can emit. @public */
export interface HxAttrsProps {
  get?: string;
  post?: string;
  put?: string;
  patch?: string;
  delete?: string;
  target?: string;
  swap?: string;
  select?: string;
  selectOob?: string;
  trigger?: string;
  include?: string;
  indicator?: string;
  disabledElt?: string;
  sync?: string;
  confirm?: string;
  encoding?: string;
  pushUrl?: string;
  replaceUrl?: string;
  params?: string;
  values?: Record<string, string>;
  headers?: Record<string, string>;
  boost?: boolean;
}

/** The `HX-*` request headers, read in one pass. @public */
export interface HxRequest {
  enabled: boolean;
  boosted: boolean;
  trigger: string;
  target: string;
  triggerName: string;
  currentUrl: string;
}

/** A flat map of `HX-*` response headers. @public */
export type HxResponseHeaders = Record<string, string>;

/** The htmx response directives `hxHeaders` can emit. @public */
export interface HxResponseProps {
  redirect?: string;
  refresh?: boolean;
  pushUrl?: string;
  replaceUrl?: string;
  trigger?: string;
  triggerAfterSettle?: string;
  triggerAfterSwap?: string;
  retarget?: string;
  reswap?: string;
}
