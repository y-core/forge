import { restTransfer } from "./export";
import type { RelaxD1Transfer } from "./types";

/** The transport a production build reaches D1's export by: always the REST API. @internal */
export const d1Transfer: RelaxD1Transfer = () => restTransfer;
