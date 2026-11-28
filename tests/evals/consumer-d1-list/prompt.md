Add a guestbook page at `/guestbook` that lists entries from the D1 database, newest first, ten to a page. `?page=2` shows the next ten,
and each page links to the next one when there is one. A `page` that isn't a positive whole number gets a `400`.

The entries live in a new `guestbook_entries` table — `id INTEGER PRIMARY KEY`, `name TEXT`, `message TEXT`, and `created_at INTEGER` in epoch
milliseconds, all required — so add it to the schema along with its migration. Add tests for it.
