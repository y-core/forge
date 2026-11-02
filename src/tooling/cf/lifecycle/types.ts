/** One R2 object lifecycle rule as the bucket's lifecycle API carries it, foreign fields kept. @internal */
export interface R2LifecycleRule {
  readonly id: string;
  readonly enabled: boolean;
  readonly conditions: { readonly prefix: string; readonly [field: string]: unknown };
  readonly deleteObjectsTransition?: { readonly condition: { readonly type: "Age"; readonly maxAge: number } };
  readonly storageClassTransitions?: readonly {
    readonly condition: { readonly type: "Age"; readonly maxAge: number };
    readonly storageClass: "InfrequentAccess";
  }[];
  readonly [field: string]: unknown;
}

/** The retention forge's rule asks for under one prefix, in days. @internal */
export interface LifecycleRetention {
  readonly prefix: string;
  readonly expireAfterDays: number | null;
  readonly infrequentAccessAfterDays: number | null;
}

/** What one lifecycle sync would do to a bucket: the rule list to write, and whether it differs from what is there. @internal */
export interface LifecyclePlan {
  readonly bucket: string;
  readonly rule: R2LifecycleRule;
  readonly before: R2LifecycleRule | null;
  readonly rules: readonly R2LifecycleRule[];
  readonly action: "in-sync" | "would-create" | "would-update";
}
