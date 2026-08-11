import { DARK_CLASS } from "../chrome/theme";
import { bindField } from "../client/bind";
import { elementById, ownerDocument } from "../client/dom";
import { openPopoverAt } from "../client/popover-anchor";
import { registerScope } from "../client/resume";
import { mountScrollSpy } from "../client/scroll-spy";
import { computed, effect } from "../client/signal";
import { mountTurnstile } from "../client/turnstile";
import type { Mode } from "../contracts/color";
import {
  buildTheme,
  CUSTOMISE_SCOPE,
  DIALS,
  type DialValues,
  HEX_ATTR,
  liveRatios,
  RADIUS_PROPERTY,
  SCALE_ROW_ATTR,
  SCALE_ROWS,
  scaleVars,
  schemeCss,
} from "../contracts/theme-contract";

/**
 * The context-menu demo. Eager, because `contextmenu` is not one of the four delegated
 * `SCOPE_EVENTS` — there is no `data-on-*` in the markup for a lazy scope to resume on, so the
 * listener has to be bound at `resume()` or never.
 */
registerScope("show-context-menu", {
  eager: true,
  setup: ({ root, state }) => {
    const popup = elementById(root, String(state.target?.value ?? ""));
    if (!popup) return;
    const onContextMenu = (event: Event) => {
      event.preventDefault();
      const { clientX, clientY, buttons } = event as MouseEvent;
      // `buttons !== 0` rather than a flat `true`: it is exactly "a pointer button is still down",
      // which is the case the guard is for. A keyboard-raised `contextmenu` reports none and is
      // followed by no release, so it opens the menu immediately instead of waiting for one.
      openPopoverAt(popup, clientX, clientY, { afterPointerUp: buttons !== 0 });
    };
    root.addEventListener("contextmenu", onContextMenu);
    return () => root.removeEventListener("contextmenu", onContextMenu);
  },
});

/**
 * The catalog rail's current-section marker.
 *
 * Eager for the same reason the context-menu demo above is: the rail is a `<details>` and a list of
 * plain anchors, so there is no `data-on-*` anywhere inside it for a lazy scope to resume on and the
 * spy would never mount. The scope root wraps the rail only, so the spy's link sweep sees the
 * catalog's fragment links and nothing else on the page.
 */
registerScope("show-toc", { eager: true, setup: ({ root }) => mountScrollSpy({ root }) });

/**
 * The Turnstile demo. Eager for the same reason the two above are: the widget's form carries no
 * `data-on-*` action, so a lazy scope would never resume and the container would sit empty.
 */
registerScope("show-turnstile", { eager: true, setup: ({ root }) => mountTurnstile(root) });

/**
 * The theme customiser's live restyle.
 *
 * **Eager**, and for a different reason from the three scopes above. Those have no `data-on-*` in
 * their markup at all; this one does — the sliders stamp `data-on-input` — so a lazy scope would
 * resume correctly on the first drag. It would just resume too late: the page would sit showing the
 * shipped scheme until someone touched a lever, which for a customiser rendered from a shared URL
 * is the wrong first frame. Eager makes the first paint the scheme the URL asked for.
 *
 * Every property goes through CSSOM `setProperty` rather than a `style` attribute, and that is
 * forced rather than chosen: forge ships `style-src 'self'` with no `'unsafe-inline'` and no style
 * nonce, and `render-to-string.ts` drops `style` attributes for exactly that reason. CSP does not
 * police the CSSOM. `popover-anchor.ts` carries the ratified statement of the same constraint.
 *
 * The disposer removes every property it wrote, as `mountAnchorBinding` does — the scope root can
 * be swapped out by an htmx boost, and properties left on `<html>` would outlive the page that
 * explained them.
 */
registerScope(CUSTOMISE_SCOPE, {
  eager: true,
  setup: ({ root, state }) => {
    const doc = ownerDocument(root);
    const html = doc.documentElement;
    const written = new Set<string>();

    // Every node the effect writes, resolved once. Caching at setup is safe for the same reason the
    // scope exists at all: a boost that swaps the root re-runs `setup`, so a stale node cannot
    // outlive the markup it came from.
    const rows = SCALE_ROWS.flatMap((row) => {
      const host = doc.querySelector<HTMLElement>(`[${SCALE_ROW_ATTR}="${row.id}"]`);
      if (host === null) return [];
      return [
        {
          row,
          // Every cell, because the box's background lives on the cells rather than on the row
          // group: a `<tbody>` background paints square, and would show through at the four rounded
          // corners the edge cells draw.
          cells: [...host.querySelectorAll<HTMLElement>("td")],
          swatches: [...host.querySelectorAll<HTMLElement>("[data-swatch]")],
          hexes: [...host.querySelectorAll<HTMLElement>(`[${HEX_ATTR}]`)],
        },
      ];
    });
    const ratioCells = new Map([...doc.querySelectorAll<HTMLElement>("[data-ratio]")].map((el) => [el.dataset.ratio ?? "", el]));
    const readouts = new Map(DIALS.map((dial) => [dial.field, root.querySelector(`[data-readout="${dial.field}"]`)]));

    /** Write and remember, so the disposer can name exactly what it added. */
    const set = (el: HTMLElement, property: string, value: string) => {
      el.style.setProperty(property, value);
      if (el === html) written.add(property);
    };

    const theme = computed(() => {
      const dials: DialValues = {};
      for (const dial of DIALS) dials[dial.field] = Number(state[dial.field]?.value ?? dial.fallback);
      return { dials, generated: buildTheme(dials) };
    });

    const stop = effect(() => {
      const { dials, generated } = theme.value;

      // The document gets the scale for the mode it is currently in. A single element cannot express
      // "these values, but only under `.dark`", so the mode is read rather than declared — and
      // re-read below when the toggle moves it.
      const mode: Mode = html.classList.contains(DARK_CLASS) ? "dark" : "light";
      for (const [name, value] of scaleVars("gray", generated.gray[mode].solid, generated.gray[mode].alpha)) set(html, name, value);
      for (const [name, value] of scaleVars("accent", generated.accent[mode].solid, generated.accent[mode].alpha)) set(html, name, value);
      set(html, RADIUS_PROPERTY, `${dials.radius ?? 10}px`);

      // Each preview row is painted on its own element, which is what lets both scales exist at
      // once — an element-level declaration outranks the `.dark` class rule the dark row carries.
      for (const { row, cells, swatches, hexes } of rows) {
        const scale = generated.gray[row.mode].solid;

        // The box demonstrates the scale **using the scale**: its page is step 1, its muted text is
        // step 11, its chip edges are step 6 — the same three steps `--background`,
        // `--muted-foreground` and `--border` resolve through. It cannot use those tokens, because
        // they compute on `:root` and inherit as literals: a nested `.dark` re-declares the steps
        // and never reaches the tokens above it. So the row is painted rather than classed, and
        // gets a truer preview than a token would have given — this is the *generated* page colour,
        // not the shipped one.
        const page = scale[0];
        const muted = scale[10];
        const edge = scale[5];
        for (const cell of cells) if (page !== undefined) cell.style.setProperty("background-color", page);
        for (const cell of hexes) if (muted !== undefined) cell.style.setProperty("color", muted);

        for (const swatch of swatches) {
          const hex = scale[Number(swatch.dataset.swatch)];
          if (hex !== undefined) swatch.style.setProperty("background-color", hex);
          if (edge !== undefined) swatch.style.setProperty("border-color", edge);
        }
        // The printed hex is a *claim about the paint above it*, so it is rewritten in the same pass
        // and out of the same array. Painting without rewriting is what made a dragged scheme print
        // the scheme it used to be.
        for (const cell of hexes) {
          const hex = scale[Number(cell.dataset.hex)];
          if (hex !== undefined) cell.textContent = hex;
        }
      }

      // "WCAG, live" is this page's headline claim, and eight cells that were rendered once and
      // never written again made it true for exactly one frame. `liveRatios` formats the string, so
      // what lands here is what the Worker wrote — the same reason `scaleVars` is shared rather than
      // reimplemented on each side.
      for (const entry of liveRatios(generated)) {
        const cell = ratioCells.get(entry.key);
        if (cell !== undefined && cell.textContent !== entry.text) cell.textContent = entry.text;
      }

      for (const dial of DIALS) {
        const readout = readouts.get(dial.field);
        if (readout != null) readout.textContent = `${dials[dial.field] ?? dial.fallback}${dial.unit}`;
      }

      const output = doc.querySelector("[data-scheme-output] code");
      if (output !== null) output.textContent = schemeCss(generated, dials);

      const share = doc.querySelector("[data-share-url]");
      const query = DIALS.map((dial) => `${dial.param}=${dials[dial.field] ?? dial.fallback}`).join("&");
      if (share !== null) share.textContent = `${doc.location.pathname}?${query}`;
    });

    // The mode toggle rewrites `<html>`'s class list without touching a signal, so the effect above
    // would keep painting the mode the page loaded in. Observing the attribute is what keeps the
    // two independent controls — the theme toggle and these dials — agreeing.
    const observer = new MutationObserver(() => {
      const { dials, generated } = theme.value;
      const mode: Mode = html.classList.contains(DARK_CLASS) ? "dark" : "light";
      for (const [name, value] of scaleVars("gray", generated.gray[mode].solid, generated.gray[mode].alpha)) set(html, name, value);
      for (const [name, value] of scaleVars("accent", generated.accent[mode].solid, generated.accent[mode].alpha)) set(html, name, value);
      set(html, RADIUS_PROPERTY, `${dials.radius ?? 10}px`);
    });
    observer.observe(html, { attributeFilter: ["class"] });

    return () => {
      observer.disconnect();
      stop();
      for (const property of written) html.style.removeProperty(property);
    };
  },
  // `bindField` closes over a `SignalRecord`, and the scope's signals only exist per invocation —
  // so the closure is built from the context rather than hoisted. forge owns the slider→signal
  // glue; the effect above is the application's half.
  on: { bindField: (ctx) => bindField(ctx.state)(ctx) },
});

registerScope("show-filter", {
  setup: ({ root, state }) => {
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-filter-item]")).map((el) => ({
      el,
      text: (el.textContent ?? "").toLowerCase(),
    }));
    const countEl = root.querySelector("[data-ref='count']");
    const querySignal = state.query;
    const visible = computed(() => items.filter((i) => i.text.includes(String(querySignal?.value ?? "").toLowerCase())));
    effect(() => {
      const shown = new Set(visible.value);
      for (const i of items) i.el.hidden = !shown.has(i);
      if (countEl) countEl.textContent = String(visible.value.length);
    });
  },
  on: {
    filter: ({ el, state }) => {
      const querySignal = state.query;
      if (querySignal) querySignal.value = (el as HTMLInputElement).value;
    },
  },
});
