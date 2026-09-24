import type { AppContext } from "../../context/types";
import type { ForgeIcon } from "../../ui/core/types";
import type { LogRow } from "../types";
import type { LogChannel } from "../types";

/** Data returned by the log viewer loader. @internal */
export interface LogViewerLoaderData {
  rows: LogRow[];
  cursor?: string | undefined;
  complete: boolean;
  level?: string | undefined;
  q?: string | undefined;
  basePath: string;
  failed?: boolean | undefined;
}

/** Access decision for the log viewer: a per-request predicate, or the explicit literal `"allow-unauthenticated"`. @public */
export type LogViewerAccess<Bindings = Record<string, unknown>> =
  | ((c: AppContext<Bindings>) => boolean | Promise<boolean>)
  | "allow-unauthenticated";

/** Options for the log viewer loader. @public */
export type LogViewerOptions<Bindings = Record<string, unknown>> = {
  channel: (c: AppContext<Bindings>) => LogChannel;
  /** Required access decision; runs before the channel is touched. */
  access: LogViewerAccess<Bindings>;
  icon: ForgeIcon<"chevron-down">;
  basePath?: string;
};
