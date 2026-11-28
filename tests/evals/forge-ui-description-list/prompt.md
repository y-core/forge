Add a `DescriptionList` component to `@y-core/forge/ui/core` for showing a record's fields as label/value pairs.

`<DescriptionList>` renders a `<dl>`, with `DescriptionList.Term` for each `<dt>` and `DescriptionList.Details` for each `<dd>`. A term can take
an optional `href`; when it has one, the term's text becomes a link to it — say, a term "Owner" linking to that person's profile. It should look at
home next to the other data-display components and be keyboard-friendly.
