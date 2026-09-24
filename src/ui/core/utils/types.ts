import type { JSXNode } from "../../../jsx/types";

/** How a compound describes itself to {@link cloneAsChild}. */
export interface AsChildOptions {
  slot: string;
  class: string;
  props: Record<string, unknown>;
  type?: string | undefined;
  disabled?: boolean | undefined;
  /** Rendered inside the cloned child, before its own children. */
  prefix?: JSXNode;
  /** Rendered inside the cloned child, after its own children. */
  suffix?: JSXNode;
  message: string;
}

/** One compound rule: every named axis must match (a list matches any of its members) for `class` to apply. @public */
export type CompoundVariant<V extends VariantConfig> = { [K in keyof V]?: keyof V[K] | ReadonlyArray<keyof V[K]> } & { class: string };

export interface CVADefinition<V extends VariantConfig> {
  base?: string;
  variants?: V;
  defaultVariants?: DefaultVariants<V>;
  compoundVariants?: ReadonlyArray<CompoundVariant<V>>;
}

export type CVAProps<V extends VariantConfig> = {
  [K in keyof V]?: keyof V[K] | undefined;
} & { class?: string | undefined };

/** One variant axis: every value it accepts, mapped to the classes that value adds. @internal */
export type VariantMap = Record<string, string>;

/** Every variant axis a `cva` resolver is defined over. @internal */
export type VariantConfig = Record<string, VariantMap>;

/** The value chosen per axis when the caller names none. @internal */
export type DefaultVariants<V extends VariantConfig> = { [K in keyof V]?: keyof V[K] };

/** The variant props a `cva` resolver accepts, without the trailing `class`. @public */
export type VariantProps<T extends (props?: never) => string> = Omit<NonNullable<Parameters<T>[0]>, "class">;

/** Where a step or timeline entry stands: done, the one in hand, or still ahead. @internal */
export type StepState = "complete" | "current" | "upcoming";
