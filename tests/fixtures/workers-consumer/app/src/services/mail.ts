// Planted: a secret read off the raw env rather than through the validated config.
export const mailKey = (c: { env: Record<string, string> }): string | undefined => c.env.SECRET;
