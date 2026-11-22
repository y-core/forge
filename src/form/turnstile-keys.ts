/** Cloudflare's published Turnstile testing site keys, secret keys and dummy token, by the outcome each forces. */
export const TURNSTILE_TEST_KEYS = Object.freeze({
  site: Object.freeze({
    pass: "1x00000000000000000000AA",
    block: "2x00000000000000000000AB",
    invisible: "1x00000000000000000000BB",
    interactive: "3x00000000000000000000FF",
  }),
  secret: Object.freeze({
    pass: "1x0000000000000000000000000000000AA",
    fail: "2x0000000000000000000000000000000AA",
    spent: "3x0000000000000000000000000000000AA",
  }),
  token: "XXXX.DUMMY.TOKEN.XXXX",
} as const);
