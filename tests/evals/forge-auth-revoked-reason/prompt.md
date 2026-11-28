Apps want to record why an API access token was revoked — "leaked in a CI log", "rotated", that kind of thing.

Add a nullable `revoked_reason` column to `auth_access_tokens` in `src/auth/schema.sql`: `TEXT`, at most 200 characters, enforced by a `CHECK`.
The revoke path should write it: take the reason as a fourth argument to `revoke`, after `at` (`null` when there is none), and give it back on
the token as `revokedReason` wherever a token is read. Apps already running forge's auth tables will need to pick this up, so make sure the
change is something they can upgrade to.
