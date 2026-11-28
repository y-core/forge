---
title: HTMX Surfaces
description: "The design consequences of swapping fragments: what a partial update does to focus, state and the reader's sense of place."
---

# HTMX Surfaces

This page is about the _design_ consequences of swapping fragments. The API — `hxAttrs`, `hxHeaders`, the pattern helpers, `isPartial` for choosing
between a page and a fragment, the trust posture on selector-valued attributes — belongs to [`HTMX.md`][htmx] and `src/render/htmx/README.md`, and
is not restated here.

The one idea everything below follows from: **a swapped region is a surface, not a hole.** It is rendered by its own handler, it can be requested
directly, and it arrives into a page that was laid out before anyone knew what it would contain. Each of those is a design obligation.

Everything here is Tier 2. It leans on two Floor rules — `forge-ui-empty-state` and `forge-ui-focus-ring` — which are in [`../floor.md`][floor] and
are not rebuttable.

---

## 0. Quick Reference

- §1 The fragment is a surface: its own boundary, its own three states, and the smallest region that changed
- §2 Latency choreography: the placeholder ships in the initial render, before any request goes out
- §3 Indicators — which element is busy: the control the reader touched, and disabling it in flight
- §4 Where a result lands: out-of-band into the flash region, at a stable id with one writer
- §5 Focus after a swap: a swap over the focused element drops focus to `<body>`

---

## 1. The fragment is a surface

<!-- rule:forge-ui-htmx-fragment-is-a-surface --> The handler that renders it can be hit directly — by a bookmark, by a retry, by a reload — and
what comes back has to be legible on its own.

<!-- rule:forge-ui-htmx-fragment-states --> `forge-ui-empty-state` is the Floor for the empty one; this rule extends the obligation to the other
two, because a fragment's error path is a _response body_, not an exception the page handles.

<!-- rule:forge-ui-htmx-empty-fragment --> A zero-row response that swaps in nothing leaves the reader looking at the previous contents, or at an
empty box, with no way to tell which.

<!-- rule:forge-ui-htmx-swap-granularity --> `SWAP` names the strategies; the design consequence of picking a coarse one is that everything inside
the target is destroyed and rebuilt, including scroll position, selection, and focus.

---

## 2. Latency choreography

The swap is the second thing that happens. The first is the request, and what the page does during it is a design decision.

Which placeholder a wait takes, and that it occupies the box the result will, are [`07-states.md`][states]'s — `forge-ui-state-skeleton-shape`,
`forge-ui-state-spinner-scope` and `forge-ui-state-preserve-layout`. What is specific to a swap is _when_ the placeholder has to exist.

<!-- rule:forge-ui-htmx-reserve-space --> An empty `<div id="results" />` is a zero-height box: the first response pushes everything below it down,
and a reader mid-click on something below is the one who pays. The placeholder is what gives the region a height before the network is involved at
all.

```tsx
import { liveSearch } from "@y-core/forge/render/htmx";
import { Input, Skeleton } from "@y-core/forge/ui/core";

// Wrong — the target empties on request, so the page jumps twice per search keystroke.
<Input name="q" {...liveSearch({ get: "/search", target: "#results" })} />;
<div id="results" />;

// Costs: every debounced keystroke reflows the page below the results, and a reader who cannot see
// the spinner has no signal at all.

// Right — the box is held open at the shape of what is coming, and the wait is announced once.
<Input name="q" {...liveSearch({ get: "/search", target: "#results" })} />;
<div id="results" class="min-h-48 space-y-2" aria-busy="false">
  <Skeleton class="h-16 w-full" />
  <Skeleton class="h-16 w-full" />
  <Skeleton class="h-16 w-full" />
</div>;
```

---

## 3. Indicators — which element is busy

<!-- rule:forge-ui-htmx-indicator-on-control --> The reader's attention is on the thing they clicked. A spinner two hundred pixels away in a region
they are not looking at answers a question nobody asked.

<!-- rule:forge-ui-htmx-disable-inflight --> `formSubmit` defaults `disable` to `"this"`, so an HTMX form built with it is already protected against
a double submit. Building the same form by hand and forgetting it is the common route to two records.

| The wait is for… | Indicator goes on | Placeholder |
| --- | --- | --- |
| A form submission | the submitting `Button` (`disable: "this"`) | none — the control's own state is the signal |
| A region of content loading | the region | `Skeleton` at the incoming shape |
| A live search | the search `Input`'s row | `Skeleton` rows in the reserved result box |
| An appended page (`infiniteScroll`) | the sentinel at the list's end | `Skeleton` row where the next item lands |
| A background action with no visible target | nothing on the page | `FlashOob` on completion |

---

## 4. Where a result lands

<!-- rule:forge-ui-htmx-oob-flash --> `FlashOob` defaults to a `beforeend` swap into `#flash-container`, which is the id `FlashContainer` renders —
so a result reaches the notification region with no coordination between the two handlers. This is the no-redirect sibling of
`forge-ui-state-flash-redirect` in [`07-states.md`][states]. Putting "Saved" inside the row that was just re-rendered means the confirmation
disappears the next time that row is swapped.

Where a failure renders is [`07-states.md`][states]'s — `forge-ui-state-error-inline` for a failure that belongs to a visible surface,
`forge-ui-state-error-toast` for one the reader is not watching. Under a swap the two map cleanly onto the two response shapes: the in-place `Alert`
is the fragment body, and the toast is an out-of-band swap. A 4xx fragment and a marked failure fragment land in their target, and any other 5xx
leaves the target as it was ([`UI_CLIENT_RUNTIME.md`][ucr-4a] §4a), so a refusal the reader can fix is rendered at 4xx beside what they did.

<!-- rule:forge-ui-htmx-oob-scoped --> An OOB selector picks its target client-side, so two handlers writing the same id produce an order dependency
nobody declared.

<!-- rule:forge-ui-htmx-append-not-replace -->

---

## 5. Focus after a swap

**A swap that replaces the focused element drops focus to `<body>`.** The reader's next Tab starts from the top of the document, and a screen reader
loses its position entirely. This is a design defect that has to be planned for at layout time, not patched afterwards.

`forge-ui-focus-ring` guarantees focus is _visible_; nothing guarantees it still exists after the DOM under it is replaced.

<!-- rule:forge-ui-htmx-restore-focus --> This is usually free: target the results region rather than the wrapper that also holds the search field,
or the row's content rather than the row.

```tsx
import { formSubmit, SWAP } from "@y-core/forge/render/htmx";
import { Button, Form, Input } from "@y-core/forge/ui/core";

// Wrong — outerHTML on the form replaces the submit button the reader just pressed.
<Form {...formSubmit({ post: "/subscribe", target: "#subscribe-form" })} id="subscribe-form">
  <Input name="email" type="email" />
  <Button type="submit">Subscribe</Button>
</Form>;

// Costs: on every submit, success or failure, focus lands on <body>. A keyboard reader has to Tab
// back through the whole page to reach the error message about their own email address.

// Right — the form stays; only the region that reports on it is swapped.
<Form {...formSubmit({ post: "/subscribe", target: "#subscribe-result", swap: SWAP.innerHtml })}>
  <Input name="email" type="email" />
  <Button type="submit">Subscribe</Button>
</Form>;
<div id="subscribe-result" class="min-h-10" />;
```

Where the triggering control must be inside the swap — an inline edit that becomes a display row — the replacement places focus on the element that
now represents what the reader was doing.

[floor]: ../floor.md
[htmx]: ../../../../docs/HTMX.md
[states]: ./07-states.md
[ucr-4a]: ../../../../docs/UI_CLIENT_RUNTIME.md#4a-which-responses-swap-html-4xx-and-marked-5xx
