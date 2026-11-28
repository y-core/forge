Add a contact form to the site at `/contact`.

`GET /contact` shows a form with `name`, `email` and `message` fields. Submitting it posts back to `/contact`. A valid submission — a
name, a real email address, and a message of at least ten characters — answers with a short thank-you fragment that names the sender and the
site, exactly like `Thanks, Ada. Forge Eval will be in touch.` where Forge Eval is the site's name. Anything invalid is refused with a `422`
that tells the visitor what to fix. Add tests for it.
