# HTMX Surfaces

This page is about the *design* consequences of swapping fragments. The API — `hxAttrs`,
`hxHeaders`, the pattern helpers, `isHxRequest`, the trust posture on selector-valued attributes —
belongs to [`HTMX.md`](../../../../.decisions/HTMX.md) and `src/html/htmx/README.md`, and is not
restated here.

The one idea everything below follows from: **a swapped region is a surface, not a hole.** It is
rendered by its own handler, it can be requested directly, and it arrives into a page that was laid
out before anyone knew what it would contain. Each of those is a design obligation.

Everything here is Tier 2. It leans on two Floor rules — `forge-ui-empty-state` and
`forge-ui-focus-ring` — which are in [`../floor.md`](../floor.md) and are not rebuttable.

---

## The fragment is a surface

Default: design the swap target as a standalone surface with its own boundary, heading and spacing,
rather than as raw content dropped into a parent's layout — unless the fragment is a single inline
value such as a count or a status word. <!-- rule:forge-ui-htmx-fragment-is-a-surface -->
The handler that renders it can be hit directly — by a bookmark, by a retry, by a reload — and what
comes back has to be legible on its own.

Default: give every swappable region three states of its own — empty, in-flight, and error — before
writing the success case — unless the region can never be any of the three. <!-- rule:forge-ui-htmx-fragment-states -->
`forge-ui-empty-state` is the Floor for the empty one; this rule extends the obligation to the other
two, because a fragment's error path is a *response body*, not an exception the page handles.

Default: return the empty state from the fragment handler itself rather than branching in the
parent — unless the parent must also collapse a wrapper the fragment does not
own. <!-- rule:forge-ui-htmx-empty-fragment -->
A zero-row response that swaps in nothing leaves the reader looking at the previous contents, or at
an empty box, with no way to tell which.

Default: swap the smallest region that actually changes — unless the change alters the region's
relationship to its neighbours, in which case swap the container. <!-- rule:forge-ui-htmx-swap-granularity -->
`SWAP` names the strategies; the design consequence of picking a coarse one is that everything inside
the target is destroyed and rebuilt, including scroll position, selection, and focus.

---

## Latency choreography

The swap is the second thing that happens. The first is the request, and what the page does during
it is a design decision that is almost always made by default — badly.

Which placeholder a wait takes, and that it occupies the box the result will, are
[`07-states.md`](./07-states.md)'s — `forge-ui-state-skeleton-shape`, `forge-ui-state-spinner-scope`
and `forge-ui-state-preserve-layout`. What is specific to a swap is *when* the placeholder has to
exist.

Default: ship the swap target's placeholder in the **initial** page render, before any request goes
out, rather than swapping one in — unless the region is not visible until the reader asks for
it. <!-- rule:forge-ui-htmx-reserve-space -->
An empty `<div id="results" />` is a zero-height box: the first response pushes everything below it
down, and a reader mid-click on something below is the one who pays. The placeholder is what gives
the region a height before the network is involved at all.

```tsx
// Wrong — the target empties on request, so the page jumps twice per search keystroke.
<Input name="q" {...liveSearch({ get: "/search", target: "#results" })} />
<div id="results" />

// Costs: every debounced keystroke reflows the page below the results, and a reader who cannot see
// the spinner has no signal at all.

// Right — the box is held open at the shape of what is coming, and the wait is announced once.
<Input name="q" {...liveSearch({ get: "/search", target: "#results" })} />
<div id="results" class="min-h-48 space-y-2" aria-busy="false">
  <Skeleton class="h-16 w-full" />
  <Skeleton class="h-16 w-full" />
  <Skeleton class="h-16 w-full" />
</div>
```

---

## Indicators — which element is busy

Default: put the busy state on the control the reader touched, via `hxAttrs`' `indicator` — unless
the request was not initiated by a control, as with `infiniteScroll`, where the indicator belongs at
the point of insertion. <!-- rule:forge-ui-htmx-indicator-on-control -->
The reader's attention is on the thing they clicked. A spinner two hundred pixels away in a region
they are not looking at answers a question nobody asked.

Default: disable the initiating control for the duration with `disabledElt`, and prefer the pattern
helper that already does it — unless the interaction is deliberately repeatable in
flight. <!-- rule:forge-ui-htmx-disable-inflight -->
`formSubmit` defaults `disabledElt` to `"this"`, so an HTMX form built with it is already protected
against a double submit. Building the same form by hand and forgetting it is the common route to
two records.

| The wait is for… | Indicator goes on | Placeholder |
|---|---|---|
| A form submission | the submitting `Button` (`disabledElt: "this"`) | none — the control's own state is the signal |
| A region of content loading | the region | `Skeleton` at the incoming shape |
| A live search | the search `Input`'s row | `Skeleton` rows in the reserved result box |
| An appended page (`infiniteScroll`) | the sentinel at the list's end | `Skeleton` row where the next item lands |
| A background action with no visible target | nothing on the page | `FlashOob` on completion |

---

## Where a result lands

Default: send the outcome of a background or global action to the flash region out-of-band with
`FlashOob`, rather than into the swapped surface — unless the message is *about* the swapped content
and belongs beside it. <!-- rule:forge-ui-htmx-oob-flash -->
`FlashOob` defaults to a `beforeend` swap into `#flash-container`, which is the id `FlashContainer`
renders — so a result reaches the notification region with no coordination between the two handlers.
This is the no-redirect sibling of `forge-ui-state-flash-redirect` in [`07-states.md`](./07-states.md).
Putting "Saved" inside the row that was just re-rendered means the confirmation disappears the next
time that row is swapped.

Where a failure renders is [`07-states.md`](./07-states.md)'s — `forge-ui-state-error-inline` for a
failure that belongs to a visible surface, `forge-ui-state-error-toast` for one the reader is no
longer watching. Under a swap the two map cleanly onto the two response shapes: the in-place `Alert`
is the fragment body, and the toast is an out-of-band swap.

Default: target out-of-band swaps at stable ids the page layout owns, and give each one exactly one
writer — unless the region is a genuine append target such as the flash
container. <!-- rule:forge-ui-htmx-oob-scoped -->
An OOB selector picks its target client-side, so two handlers writing the same id produce an order
dependency nobody declared.

Default: append with `infiniteScroll` rather than re-rendering the whole collection — unless the
sort or filter changed, in which case the whole list is the smallest region that
changed. <!-- rule:forge-ui-htmx-append-not-replace -->

---

## Focus after a swap

**A swap that replaces the focused element drops focus to `<body>`.** The reader's next Tab starts
from the top of the document, and a screen reader loses its position entirely. This is a design
defect that has to be planned for at layout time, not patched afterwards — it is the single most
common way an otherwise correct HTMX page becomes unusable by keyboard.

`forge-ui-focus-ring` guarantees focus is *visible*; nothing guarantees it still exists after the
DOM under it is replaced.

Default: choose a swap target that does not contain the control that triggered the request — unless
the control is genuinely part of the content being replaced. <!-- rule:forge-ui-htmx-restore-focus -->
This is usually free: target the results region rather than the wrapper that also holds the search
field, or the row's content rather than the row.

```tsx
// Wrong — outerHTML on the form replaces the submit button the reader just pressed.
<Form {...formSubmit({ post: "/subscribe", target: "#subscribe-form" })} id="subscribe-form">
  <Input name="email" type="email" />
  <Button type="submit">Subscribe</Button>
</Form>

// Costs: on every submit, success or failure, focus lands on <body>. A keyboard reader has to Tab
// back through the whole page to reach the error message about their own email address.

// Right — the form stays; only the region that reports on it is swapped.
<Form {...formSubmit({ post: "/subscribe", target: "#subscribe-result", swap: SWAP.innerHtml })}>
  <Input name="email" type="email" />
  <Button type="submit">Subscribe</Button>
</Form>
<div id="subscribe-result" class="min-h-10" />
```

Where the triggering control genuinely must be inside the swap — an inline edit that becomes a
display row — the replacement has to place focus deliberately, on the element that now represents
what the reader was doing.
