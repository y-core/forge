import type { SCOPE_EVENTS } from "./scope-events";
import type { STATE_ATTRS } from "./state-attrs";
import type { APPEARANCES } from "./vocabulary";
import type { PRESENTATION_ATTRS } from "./vocabulary";
import type { TONES } from "./vocabulary";
// Each control gets two fields, not one: a second instance in a different state is what shows the
// binding is per-field rather than per-component, and it is where `controlsReadout`'s empty and
// off branches are actually rendered.
/** The signal fields the bound-control band renders and resumes. @internal */
export interface ControlsDemoState {
  text: string;
  email: string;
  unit: string;
  precision: string;
  level: number;
  zoom: number;
  enabled: boolean;
  notifications: boolean;
  notes: string;
  summary: string;
  align: string;
  weight: string;
  mirror: string;
  count: number;
  bold: boolean;
  plan: string;
  toppings: string[];
  avatar: string;
  code: string;
  pin: string;
}

/** The actions a checkable menu row names in `data-on-click` and the client scope handles. @public */
export type MenuAction = "check" | "select";

/** What {@link menuItemAttrs} needs to know about the row it is describing. */
export interface MenuItemAttrsOptions {
  // Omit for a disabled row or a submenu header: the platform runs an invoker command regardless
  // of `aria-disabled`, so such a row would dismiss a menu that must stay open.
  /** id of the enclosing menu popup, which emits the `hide-popover` invoker command. */
  readonly closes?: string | false | undefined;
  /** `menuitemcheckbox` / `menuitemradio` instead of a plain `menuitem`. @default "menuitem" */
  readonly role?: "menuitem" | "menuitemcheckbox" | "menuitemradio";
  /** Marks the row `aria-disabled`, keeping it focusable and in the navigation ring. */
  readonly disabled?: boolean;
  /** Initial checked state of a `menuitemcheckbox` or `menuitemradio`. @default false */
  readonly checked?: boolean;
}

/** Typed `data-on-<event>` props for a `Resumable` scope, keyed by action name from `A`. @public */
export type ScopeAttrsProps<A extends string = string> = {
  [E in ScopeEvent as `on${Capitalize<E>}`]?: A;
};

/** One of the delegated scope events. @public */
export type ScopeEvent = (typeof SCOPE_EVENTS)[number];

/** The action the slider input names in `data-on-input` and the client scope handles. @public */
export type SliderAction = "sync";

/** One of the declared state-attribute names. @public */
export type StateAttrName = (typeof STATE_ATTRS)[keyof typeof STATE_ATTRS];

/** Layout axis. @public */
export type Orientation = "horizontal" | "vertical";

/** A physical side — what a popup, drawer, or rail is anchored to when the reader's direction must not mirror it. @public */
export type PhysicalSide = "top" | "right" | "bottom" | "left";

/** Side a popup is positioned on, in either physical or logical spelling. @public */
export type Side = PhysicalSide | "block-start" | "block-end" | "inline-start" | "inline-end";

/** Alignment of a popup along its side. @public */
export type Align = "start" | "center" | "end";

/** The states a forge component can declare; an omitted key differs from `false`. @public */
export interface StateAttrsProps {
  pressed?: boolean | undefined;
  checked?: boolean | undefined;
  selected?: boolean | undefined;
  disabled?: boolean | undefined;
  invalid?: boolean | undefined;
  busy?: boolean | undefined;
  orientation?: Orientation | undefined;
  side?: Side | undefined;
  align?: Align | undefined;
}

/** The action a theme toggle names in `data-on-click`. @public */
export type ThemeAction = "cycleTheme";

/** Why a held submit press was dropped. @public */
export type TurnstileAbandonReason = "timeout" | "interactive-timeout" | "error" | "unsupported" | "superseded";

/** `detail` of `TURNSTILE_ABANDONED_EVENT`; the event's target is the form the press was made on. @public */
export type TurnstileAbandonedDetail = { reason: TurnstileAbandonReason; submitter: HTMLElement | null };

/** One of {@link TONES}. @public */
export type Tone = (typeof TONES)[number];

/** One of {@link APPEARANCES}. @public */
export type Appearance = (typeof APPEARANCES)[number];

/** The three control heights, read from `--control-h-*`. @public */
export type Size = "sm" | "md" | "lg";

/** A button's footprint beyond its size: text, an icon-only square, a full-width square, or a circle. @public */
export type Shape = "default" | "icon" | "square" | "circle";

/** One of the declared presentational-attribute names. @public */
export type PresentationAttrName = (typeof PRESENTATION_ATTRS)[keyof typeof PRESENTATION_ATTRS];

/** The presentational axes a forge component can declare; an omitted key emits nothing. @public */
export interface PresentationAttrsProps {
  tone?: Tone | undefined;
  appearance?: Appearance | undefined;
  size?: Size | undefined;
  state?: string | undefined;
}
