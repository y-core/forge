/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../jsx/types";
import { Button } from "../core/button";
import { Flash, type FlashMessage, FlashOob } from "../server/flash";
import { Resumable } from "../server/resumable";
import { CatalogSection } from "./components";
import {
  LAZY_DEMO_PENDING,
  LAZY_DEMO_REF,
  LAZY_DEMO_SCOPE,
  LAZY_DEMO_STATUS_REF,
  LAZY_RETRY_FAILURES,
  LAZY_RETRY_PENDING,
  LAZY_RETRY_REF,
  LAZY_RETRY_STATUS_REF,
} from "./lazy-contract";
import type { ShowcasePaths } from "./route";

/** One message of each severity, so the section shows every variant `Flash` can emit. */
const FLASH_SAMPLE: FlashMessage[] = [
  { type: "success", title: "Saved", text: "Your changes are live." },
  { type: "info", text: "A build is running." },
  { type: "warning", text: "This key expires next week." },
  { type: "error", text: "Could not reach the server." },
];

const OOB_MARKUP = '<div hx-swap-oob="beforeend:#flash-container"> … </div>';

/** The Flash channel demo — server-pushed messages into the page's one live region. @internal */
export const FlashSection: FC<{ paths: ShowcasePaths }> = ({ paths }) => (
  <CatalogSection id='flash' title='Flash'>
    <p class='w-full max-w-prose text-sm text-muted-foreground text-pretty'>
      Flash is the server channel to the reader: <code>createFlash</code> writes the messages onto a signed, single-read cookie, and the next render
      hands them to <code>FlashContainer</code> — the fixed container at the bottom right of this page, and the only live region on it.{" "}
      <code>FlashOob</code> swaps one message into that same container mid-page, with no reload.
    </p>
    <Button variant='secondary' size='sm' hx-get={`${paths.toast}?type=info`} hx-swap='none'>
      Flash a message
    </Button>
    <p class='w-full max-w-prose text-xs text-muted-foreground text-pretty'>
      Each message renders as a dismissible Toast that removes itself after five seconds. Below is exactly what the three server components emit,
      rendered inline so the markup is on the page rather than only described by it.
    </p>
    <div class='w-full space-y-2'>
      <h3 class='text-sm font-semibold text-foreground'>Flash — the messages themselves</h3>
      <div class='relative flex flex-col gap-2'>
        <Flash messages={FLASH_SAMPLE} />
      </div>
      <h3 class='text-sm font-semibold text-foreground'>FlashOob — one message, swapped into the live container</h3>
      {/* `hidden`, because an out-of-band wrapper is an instruction to htmx rather than page content:
          showing it inline would put a second copy of the toast on screen. */}
      <div hidden>
        <FlashOob messages={[{ type: "info", text: "Swapped in without a reload." }]} />
      </div>
      <pre class='overflow-x-auto rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground'>
        <code>{OOB_MARKUP}</code>
      </pre>
    </div>
  </CatalogSection>
);

/** The `lazy()` demo — a module held back until its anchor enters the viewport. @internal */
export const LazySection: FC = () => (
  <CatalogSection id='lazy' title='Lazy'>
    <Resumable name={LAZY_DEMO_SCOPE} class='w-full space-y-3'>
      <p class='max-w-prose text-sm text-muted-foreground text-pretty'>
        <code>lazy()</code> holds a module back until its anchor is seen: the panel below names a <code>data-ref</code>, the scope observes it, and
        the module is fetched and evaluated the first time the panel enters the viewport. A rejected load is retried up to three times.
      </p>
      <div data-ref={LAZY_DEMO_REF} class='flex min-h-24 w-full flex-col gap-3 rounded-xl border border-dashed border-border p-4'>
        <p data-ref={LAZY_DEMO_STATUS_REF} class='text-sm text-foreground'>
          {LAZY_DEMO_PENDING}
        </p>
      </div>
      <p class='max-w-prose text-sm text-muted-foreground text-pretty'>
        The second anchor proves that last sentence rather than asserting it: its first {LAZY_RETRY_FAILURES} loads reject on purpose, its{" "}
        <code>onError</code> writes each attempt to the line below, and the third resolves.
      </p>
      <div data-ref={LAZY_RETRY_REF} class='flex min-h-24 w-full flex-col gap-3 rounded-xl border border-dashed border-border p-4'>
        <p data-ref={LAZY_RETRY_STATUS_REF} role='status' class='text-sm text-foreground'>
          {LAZY_RETRY_PENDING}
        </p>
      </div>
    </Resumable>
  </CatalogSection>
);
