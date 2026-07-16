type VariantMap = Record<string, string>;
type VariantConfig = Record<string, VariantMap>;
type DefaultVariants<V extends VariantConfig> = { [K in keyof V]?: keyof V[K] };

export interface CVADefinition<V extends VariantConfig> {
  base?: string;
  variants?: V;
  defaultVariants?: DefaultVariants<V>;
}

export type CVAProps<V extends VariantConfig> = {
  [K in keyof V]?: keyof V[K];
} & { class?: string };

/**
 * Class-variance-authority: builds a class-name resolver from a `base` string plus named
 * variant maps and their defaults. The returned function takes selected variant values (and
 * an optional `class` override) and returns the composed class string. @public
 */
export function cva<V extends VariantConfig>(config: CVADefinition<V>) {
  const base = config.base ?? "";
  const variants = config.variants;
  const defaultVariants = config.defaultVariants ?? ({} as DefaultVariants<V>);
  const variantKeys = variants ? (Object.keys(variants) as (keyof V)[]) : [];

  return (props?: CVAProps<V>): string => {
    const parts: string[] = base ? [base] : [];

    for (const key of variantKeys) {
      const variantMap = (variants as VariantConfig)[key as string] as VariantMap;
      const value = (props?.[key] ?? defaultVariants[key]) as string | undefined;
      if (value && variantMap[value]) {
        parts.push(variantMap[value]);
      }
    }

    if (props?.class) {
      parts.push(props.class);
    }

    return parts.join(" ");
  };
}
