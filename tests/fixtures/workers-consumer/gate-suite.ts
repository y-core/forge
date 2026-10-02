import type { CheckResult, ImportBoundaryCheckConfig } from "@y-core/forge/tooling/gate/types";

export type CheckImportBoundary = (config: ImportBoundaryCheckConfig) => CheckResult;
