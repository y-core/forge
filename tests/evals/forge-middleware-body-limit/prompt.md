Add a `bodyLimit({ maxBytes })` middleware to `@y-core/forge/security`, so an app can cap how large a request body a route accepts.

It should answer `413` when the body is over `maxBytes`. Check `Content-Length` first so an obviously oversized upload is refused without
reading it, but don't trust the header alone: a chunked body with no `Content-Length`, or one whose header understates it, has to be caught by
counting the bytes as they stream in. A body within the limit must still reach the handler intact.
