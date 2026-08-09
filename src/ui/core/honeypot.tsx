/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { HONEYPOT_FIELD_DEFAULT } from "../../form/constants";
import type { FC } from "../../jsx/types";

interface HoneypotProps {
  /** Name of the decoy field. Defaults to the constant `isHoneypotFilled` inspects, so the two
   * agree without the consumer restating it. Override only if you also pass the same name to
   * `isHoneypotFilled`. */
  field?: string;
}

/**
 * A decoy text input positioned off-screen: a human never sees it, a naive bot fills every field it
 * finds. Pair it with `isHoneypotFilled` from the `form` namespace on the handler side. @public
 *
 * **Compose it explicitly — `Form` no longer renders one.** It used to, unconditionally, which put
 * `?__surname=` into the query string of every `method="get"` form: into the address bar, into
 * bookmarks and shared links, into history, and into the outbound `Referer`. The honeypot has no
 * defensive value on GET anyway — it flags bots submitting spam, and only mutation handlers consult
 * `isHoneypotFilled` — so the fix is to let the caller place it, on the forms where it means
 * something.
 *
 * ```tsx
 * <Form method='post' csrfToken={token}>
 *   <Honeypot />
 *   <Input name='email' />
 * </Form>
 * ```
 */
export const Honeypot: FC<HoneypotProps> = ({ field = HONEYPOT_FIELD_DEFAULT }) => (
  <div aria-hidden='true' class='absolute -left-[9999px] opacity-0 pointer-events-none'>
    <input type='text' name={field} tabindex={-1} autocomplete='off' />
  </div>
);
