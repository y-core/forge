import type { AnnouncePoliteness } from "./types";

/** The scope name `<Announcer />` stamps and `ui/core/client` registers. @public */
export const ANNOUNCER_SCOPE = "announcer";

/** The `data-slot` of the one region each politeness is spoken through. @public */
export const ANNOUNCER_REGION_SLOTS: Readonly<Record<AnnouncePoliteness, string>> = {
  polite: "announcer-polite",
  assertive: "announcer-assertive",
};

/** How long a channel waits for a later message before it speaks its latest one. @public */
export const ANNOUNCE_SETTLE_MS = 200;

/** How long a spoken message stays in its region before it is removed, so a browse-mode reader never meets stale text. @public */
export const ANNOUNCE_LINGER_MS = 7000;

/** The channel a busy indicator's label is announced on, and cancelled on when the wait ends. @public */
export const ANNOUNCE_BUSY_CHANNEL = "busy";

/** The channel the first field error of a failed submission is announced on. @public */
export const ANNOUNCE_FORM_ERROR_CHANNEL = "form-error";

/** The channel a failure panel's message is announced on, when it arrives in a swap or with the page. @public */
export const ANNOUNCE_FAILURE_CHANNEL = "failure";

/** The attribute that marks a failure panel, holding the message spoken assertively when it arrives. @public */
export const ANNOUNCE_FAILURE_ATTR = "data-announce-failure";

/** The channel every toast is announced on, none dropped for a later one. @public */
export const ANNOUNCE_TOAST_CHANNEL = "toast";

/** The channel a Turnstile challenge's failure is announced on. @public */
export const ANNOUNCE_TURNSTILE_CHANNEL = "turnstile";
