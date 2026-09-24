/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../../jsx/types";

interface AuthTimestampProps {
  readonly at: number;
  readonly "data-ref"?: string | undefined;
}

/** One stored epoch millisecond as a UTC date, machine-readable in the attribute and readable in the text. @internal */
export const AuthTimestamp: FC<AuthTimestampProps> = ({ at, "data-ref": ref }) => {
  const moment = new Date(at).toISOString();
  return (
    <time data-ref={ref} datetime={moment} class='tabular-nums'>
      {moment.slice(0, 10)}
    </time>
  );
};
