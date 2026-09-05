import type { ResourceType, SyncResult, WranglerConfig } from "../../types";
import type { ReconcileResult, ResourceHandler } from "./types";

type AnyEntry = { binding?: string; name?: string; [key: string]: unknown };

function getBinding(entry: AnyEntry): string {
  return (entry.binding ?? entry.name ?? "unknown") as string;
}

/** What a handler that performs no API call knows about its bindings. */
export type Verification = { kind: "no-remote-object"; reason: string } | { kind: "unverified"; reason: string };

/** The detail every unverified handler emits. */
export const UNVERIFIED_DETAIL = "not verified — no read API";

/** Creates a handler for bindings this tool does not provision, which must state what it checked. */
export function createDeclarativeHandler(
  type: ResourceType,
  displayName: string,
  extractFn: (config: WranglerConfig) => AnyEntry[],
  verification: Verification,
): ResourceHandler<AnyEntry> {
  return {
    type,
    displayName,
    extract: extractFn,
    async reconcile(entries, _ctx): Promise<ReconcileResult<AnyEntry>> {
      const results: SyncResult[] = entries.map((entry) => ({
        resourceType: type,
        binding: getBinding(entry),
        action: "deploy-pushes" as const,
        local: true,
        detail: verification.kind === "no-remote-object" ? verification.reason : UNVERIFIED_DETAIL,
      }));
      return { entries, results };
    },
  };
}

export const durableObjectsHandler = createDeclarativeHandler(
  "durable_objects",
  "Durable Objects",
  (c) => (c.durable_objects?.bindings ?? []) as unknown as AnyEntry[],
  { kind: "no-remote-object", reason: "bound to a class in the deployed script, with no separate resource" },
);

export const aiHandler = createDeclarativeHandler("ai", "Workers AI", (c) => (c.ai ? [c.ai as AnyEntry] : []), {
  kind: "no-remote-object",
  reason: "an account-level capability, not a provisioned resource",
});

export const browserHandler = createDeclarativeHandler("browser", "Browser Rendering", (c) => (c.browser ? [c.browser as AnyEntry] : []), {
  kind: "no-remote-object",
  reason: "an account-level capability, not a provisioned resource",
});

export const analyticsEngineHandler = createDeclarativeHandler(
  "analytics_engine_datasets",
  "Analytics Engine",
  (c) => (c.analytics_engine_datasets ?? []) as unknown as AnyEntry[],
  { kind: "no-remote-object", reason: "the dataset is created implicitly on first write" },
);

export const hyperdriveHandler = createDeclarativeHandler("hyperdrive", "Hyperdrive", (c) => (c.hyperdrive ?? []) as unknown as AnyEntry[], {
  kind: "unverified",
  reason: "hyperdrive configs are listable but not yet queried here",
});

export const vectorizeHandler = createDeclarativeHandler("vectorize", "Vectorize", (c) => (c.vectorize ?? []) as unknown as AnyEntry[], {
  kind: "unverified",
  reason: "vectorize indexes are listable but not yet queried here",
});

export const servicesHandler = createDeclarativeHandler("services", "Service Bindings", (c) => (c.services ?? []) as unknown as AnyEntry[], {
  kind: "unverified",
  reason: "the target worker is listable but not yet queried here",
});

export const sendEmailHandler = createDeclarativeHandler("send_email", "Email Routing", (c) => (c.send_email ?? []) as unknown as AnyEntry[], {
  kind: "unverified",
  reason: "destination addresses are listable but not yet queried here",
});

export const dispatchNamespacesHandler = createDeclarativeHandler(
  "dispatch_namespaces",
  "Dispatch Namespaces",
  (c) => (c.dispatch_namespaces ?? []) as unknown as AnyEntry[],
  { kind: "unverified", reason: "dispatch namespaces are listable but not yet queried here" },
);

export const mtlsCertificatesHandler = createDeclarativeHandler(
  "mtls_certificates",
  "mTLS Certificates",
  (c) => (c.mtls_certificates ?? []) as unknown as AnyEntry[],
  { kind: "unverified", reason: "uploaded certificates are listable but not yet queried here" },
);

export const workflowsHandler = createDeclarativeHandler("workflows", "Workflows", (c) => (c.workflows ?? []) as unknown as AnyEntry[], {
  kind: "unverified",
  reason: "workflows are listable but not yet queried here",
});

export const pipelinesHandler = createDeclarativeHandler("pipelines", "Pipelines", (c) => (c.pipelines ?? []) as unknown as AnyEntry[], {
  kind: "unverified",
  reason: "pipelines are listable but not yet queried here",
});
