type VariantMap = Record<string, string>;
type VariantConfig = Record<string, VariantMap>;
type DefaultVariants<V extends VariantConfig> = { [K in keyof V]?: keyof V[K] };

export interface CVAConfig<V extends VariantConfig> {
  base?: string;
  variants?: V;
  defaultVariants?: DefaultVariants<V>;
}

export type CVAProps<V extends VariantConfig> = {
  [K in keyof V]?: keyof V[K];
} & { class?: string };

export function cva<V extends VariantConfig>(config: CVAConfig<V>) {
  return (props?: CVAProps<V>): string => {
    const { variants, base = "", defaultVariants = {} as DefaultVariants<V> } = config;
    const parts: string[] = base ? [base] : [];

    if (variants) {
      for (const key of Object.keys(variants) as (keyof V)[]) {
        const variantMap = variants[key] as VariantMap;
        const value = (props?.[key] ?? defaultVariants[key]) as string | undefined;
        if (value && variantMap[value]) {
          parts.push(variantMap[value]);
        }
      }
    }

    if (props?.class) {
      parts.push(props.class);
    }

    return parts.join(" ");
  };
}
