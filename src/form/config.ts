import { v } from "../validation/mod";

export interface CsrfConfig {
  secret: string;
}

export interface TurnstileConfig {
  secretKey: string;
  siteKey: string;
}

export const CsrfConfigSchema = v.object({
  secret: v.pipe(
    v.string(),
    v.regex(/^[0-9a-fA-F]{32,}$/, "must be at least 32 hex characters"),
  ),
});

export const TurnstileConfigSchema = v.object({
  secretKey: v.string(),
  siteKey: v.string(),
});
