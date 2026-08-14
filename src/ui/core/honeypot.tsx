/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { HONEYPOT_FIELD_DEFAULT } from "../../form/constants";
import type { FC } from "../../jsx/types";

interface HoneypotProps {
  field?: string;
}

/** A decoy text input positioned off-screen that naive bots fill; pair with `isHoneypotFilled`. @public */
export const Honeypot: FC<HoneypotProps> = ({ field = HONEYPOT_FIELD_DEFAULT }) => (
  <div aria-hidden='true' class='absolute -left-[9999px] opacity-0 pointer-events-none'>
    <input type='text' name={field} tabindex={-1} autocomplete='off' />
  </div>
);
