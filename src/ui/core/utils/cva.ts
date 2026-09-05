import { cn } from "./cn";

type VariantMap = Record<string, string>;
type VariantConfig = Record<string, VariantMap>;
type DefaultVariants<V extends VariantConfig> = { [K in keyof V]?: keyof V[K] };

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

/** The variant props a `cva` resolver accepts, without the trailing `class`. @public */
export type VariantProps<T extends (props?: never) => string> = Omit<NonNullable<Parameters<T>[0]>, "class">;

/** Builds a class-name resolver that composes `base` → variants → matching compounds → `class` through `cn`, so a later part overrides an earlier one. @public */
export function cva<V extends VariantConfig>(config: CVADefinition<V>) {
  const base = config.base ?? "";
  const variants = config.variants;
  const defaultVariants = config.defaultVariants ?? ({} as DefaultVariants<V>);
  const compounds = config.compoundVariants ?? [];
  const variantKeys = variants ? (Object.keys(variants) as (keyof V)[]) : [];

  return (props?: CVAProps<V>): string => {
    const parts: string[] = base ? [base] : [];
    const resolved: Partial<Record<keyof V, string>> = {};

    for (const key of variantKeys) {
      const variantMap = (variants as VariantConfig)[key as string] as VariantMap;
      const value = (props?.[key] ?? defaultVariants[key]) as string | undefined;
      if (value === undefined) continue;
      resolved[key] = value;
      if (variantMap[value]) parts.push(variantMap[value]);
    }

    for (const compound of compounds) {
      const { class: cls, ...conditions } = compound;
      const matches = (Object.entries(conditions) as [keyof V, keyof V[keyof V] | ReadonlyArray<keyof V[keyof V]>][]).every(([key, wanted]) =>
        Array.isArray(wanted) ? (wanted as ReadonlyArray<string>).includes(resolved[key] as string) : resolved[key] === wanted,
      );
      if (matches && cls) parts.push(cls);
    }

    if (props?.class) {
      parts.push(props.class);
    }

    return cn(...parts);
  };
}
