/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { ANNOUNCER_REGION_SLOTS, ANNOUNCER_SCOPE } from "../contracts/announcer-contract";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

/** The page's one pair of live regions, visually hidden, that `announce()` speaks through; stamp it once in the layout. @public */
export const Announcer: FC<Omit<JSX.IntrinsicElements["div"], "children">> = ({ class: cls, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("announcer", inherited)} data-scope={ANNOUNCER_SCOPE} class={cn("sr-only", cls)} {...rest}>
    <div data-slot={ANNOUNCER_REGION_SLOTS.polite} aria-live='polite' />
    {/* oxlint-disable-next-line forge/a11y-live-politeness -- the page's one assertive region; `announce()` routes only a failure that stops the reader's task here. */}
    <div data-slot={ANNOUNCER_REGION_SLOTS.assertive} aria-live='assertive' />
  </div>
);
