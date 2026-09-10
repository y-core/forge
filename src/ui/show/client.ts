// The showcase's markup names the `theme` and `navbar` scopes from chrome and the `menu`,
// `toolbar`, `toast`, `number-field`, `slider`, `popover`, `dialog` and `turnstile` scopes from
// core. `chrome/client` pulls `core/client` itself, but naming both is what keeps this entry honest
// if that ever stops being true — an app importing only this one would otherwise resume none of them.
import "../chrome/client";
import "../core/client";
import { bindControls } from "../client/bind";
import { bindAttr, bindText } from "../client/bind-display";
import { mountCarouselDots } from "../client/carousel";
import { elementById, ownerDocument, ownerWindow } from "../client/dom";
import { lazy } from "../client/lazy";
import { openPopoverAt } from "../client/popover-anchor";
import { registerScope, resumeScope } from "../client/resume";
import { mountScrollSpy } from "../client/scroll-spy";
import { computed, effect } from "../client/signal";
import type { SignalRecord } from "../client/types";
import { CONTROLS_DEMO_SCOPE, controlsReadout } from "../contracts/controls-demo-contract";
import { NAVBAR_FILTERS_EVENT } from "../contracts/navbar-contract";
import {
  buildTheme,
  COPY_ACTION,
  COPY_CONFIRM_MS,
  COPY_LABEL_ATTR,
  COPY_SCOPE,
  COPY_STATUS_ATTR,
  COPY_TARGET_ATTR,
  COPY_TARGETS,
  CUSTOMISE_SCOPE,
  DIALS,
  dialQuery,
  HEX_ATTR,
  liveRatios,
  matchPreset,
  PRESET_ACTION,
  PRESET_CUSTOM,
  PRESET_FIELDS,
  RADIUS_PROPERTY,
  SCALE_ROW_ATTR,
  SCALE_ROWS,
  SCHEME_PRESETS,
  scaleVars,
  schemeCss,
  shapeVars,
} from "../contracts/theme/theme-contract";
import type { DialValues } from "../contracts/theme/types";
import { LAZY_DEMO_REF, LAZY_DEMO_SCOPE, LAZY_RETRY_FAILURES, LAZY_RETRY_REF, LAZY_RETRY_STATUS_REF, lazyRetryAttempt } from "./lazy-contract";
import { SHOW_SCOPES } from "./scope-contract";
import { TOAST_CYCLE_GAP, TOAST_CYCLE_SCOPE } from "./toast-contract";

/** A `<select>` reduced to the one member this page reads and writes. */
type ValueControl = Element & { value?: string };

// Eager: `contextmenu` is not a delegated `SCOPE_EVENT`, so there is no `data-on-*` in the markup
// for a lazy scope to resume on.
registerScope(SHOW_SCOPES.contextMenu, {
  eager: true,
  setup: ({ root, state }) => {
    const popup = elementById(root, String(state.target?.value ?? ""));
    if (!popup) return;
    const onContextMenu = (event: Event) => {
      event.preventDefault();
      const { clientX, clientY, buttons } = event as MouseEvent;
      // A keyboard-raised `contextmenu` reports no buttons and is followed by no release, so it must
      // not wait for one.
      openPopoverAt(popup, clientX, clientY, { afterPointerUp: buttons !== 0 });
    };
    root.addEventListener("contextmenu", onContextMenu);
    return () => root.removeEventListener("contextmenu", onContextMenu);
  },
});

registerScope(SHOW_SCOPES.toc, { eager: true, setup: ({ root }) => mountScrollSpy({ root }) });

// Eager, and a demo device rather than a `Toast` behaviour — `show/toast-contract.ts` says why. The
// `toast` scope owns the duration and the removal; this one notices the empty container and refills.
registerScope(TOAST_CYCLE_SCOPE, {
  eager: true,
  setup: ({ root }) => {
    const container = root.querySelector<HTMLElement>("[data-slot~='toast-container']");
    const toast = container?.querySelector<HTMLElement>("[data-slot~='toast']");
    if (!container || !toast) return;

    const win = ownerWindow(root);
    const observerCtor = (win as Window & { MutationObserver?: typeof MutationObserver }).MutationObserver;
    if (typeof observerCtor !== "function") return;

    // Cloned before the first cycle removes it: the node itself is what the toast scope deletes, and
    // a template read afterwards would have nothing to read.
    const template = toast.cloneNode(true) as HTMLElement;
    let pending = 0;

    const refill = () => {
      pending = 0;
      const fresh = template.cloneNode(true) as HTMLElement;
      container.appendChild(fresh);
      // The clone carries `data-scope="toast"` but was never in the page when `resume()` ran, so its
      // own duration timer only starts if this says so.
      resumeScope(fresh);
    };

    const observer = new observerCtor(() => {
      if (pending !== 0 || container.querySelector("[data-slot~='toast']")) return;
      pending = win.setTimeout(refill, TOAST_CYCLE_GAP);
    });
    observer.observe(container, { childList: true });

    return () => {
      observer.disconnect();
      win.clearTimeout(pending);
    };
  },
});

// Eager: the dots must already follow the strip when the reader presses the first one — there is no
// earlier interaction for a lazy scope to resume on.
registerScope(SHOW_SCOPES.carousel, {
  eager: true,
  setup: ({ root }) => {
    const dots = root.querySelector("[data-slot~='carousel-dots']");
    if (!dots) return;
    return mountCarouselDots({ root: dots });
  },
});

// Every property is written through CSSOM rather than a `style` attribute: forge ships
// `style-src 'self'` with no style nonce, and `render-to-string.ts` drops `style` attributes.
registerScope(CUSTOMISE_SCOPE, {
  eager: true,
  setup: ({ root, state }) => {
    const doc = ownerDocument(root);
    const html = doc.documentElement;
    const written = new Set<string>();

    const rows = SCALE_ROWS.flatMap((row) => {
      const host = doc.querySelector<HTMLElement>(`[${SCALE_ROW_ATTR}="${row.id}"]`);
      if (host === null) return [];
      return [
        {
          row,
          cells: [...host.querySelectorAll<HTMLElement>("td")],
          swatches: [...host.querySelectorAll<HTMLElement>("[data-swatch]")],
          hexes: [...host.querySelectorAll<HTMLElement>(`[${HEX_ATTR}]`)],
        },
      ];
    });
    const ratioCells = new Map([...doc.querySelectorAll<HTMLElement>("[data-ratio]")].map((el) => [el.dataset.ratio ?? "", el]));
    const readouts = new Map(DIALS.map((dial) => [dial.field, root.querySelector(`[data-readout="${dial.field}"]`)]));
    const picker = root.querySelector("select[data-preset-picker]") as ValueControl | null;
    const output = doc.querySelector("[data-scheme-output] code");
    const share = doc.querySelector("[data-share-url]");

    // Both directions, for every dial at once. The thumb now follows a signal moved by anything —
    // a preset pick, a shared link — with no per-control write-back on this page at all.
    const unbind = bindControls(root, state as SignalRecord<Record<string, unknown>>);

    /** Write and remember, so the disposer can name exactly what it added. */
    const set = (el: HTMLElement, property: string, value: string) => {
      el.style.setProperty(property, value);
      if (el === html) written.add(property);
    };

    const view = ownerWindow(root);
    let frame = 0;
    let pending: { generated: ReturnType<typeof buildTheme>; dials: DialValues } | null = null;

    const paintText = () => {
      frame = 0;
      if (pending === null) return;
      if (output !== null) output.textContent = schemeCss(pending.generated, pending.dials);
      if (share !== null) share.textContent = `${doc.location.pathname}?${dialQuery(pending.dials)}`;
    };

    const theme = computed(() => {
      const dials: DialValues = {};
      // `??` cannot catch a NaN, and `Number("")` is 0 while `Number("x")` is NaN — an unguarded read
      // gives `NaN\u00b0` readouts, a `?ah=NaN` share URL and an `oklch(NaN% ...)` the browser drops.
      for (const dial of DIALS) {
        const parsed = Number(state[dial.field]?.value ?? dial.fallback);
        dials[dial.field] = Number.isFinite(parsed) ? parsed : dial.fallback;
      }
      return { dials, generated: buildTheme(dials) };
    });

    effect(() => {
      const { dials, generated } = theme.value;

      // One value per property, both modes inside it: the browser picks the branch, so nothing here
      // has to notice the theme toggle rewriting `<html>`'s class list.
      for (const [name, value] of scaleVars("gray", generated.gray)) set(html, name, value);
      for (const [name, value] of scaleVars("accent", generated.accent)) set(html, name, value);
      set(html, RADIUS_PROPERTY, `${dials.radius ?? 10}px`);
      for (const [name, value] of shapeVars(dials)) set(html, name, value);

      // Each row is painted on its own element: the semantic tokens compute on `:root` and inherit
      // as literals, so a nested `.dark` class could never give one row the other mode's scale.
      for (const { row, cells, swatches, hexes } of rows) {
        const scale = generated[row.family][row.mode].solid;

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
        for (const cell of hexes) {
          const hex = scale[Number(cell.dataset.hex)];
          if (hex !== undefined) cell.textContent = hex;
        }
      }

      for (const entry of liveRatios(generated)) {
        const cell = ratioCells.get(entry.key);
        if (cell !== undefined && cell.textContent !== entry.text) cell.textContent = entry.text;
      }

      for (const dial of DIALS) {
        const readout = readouts.get(dial.field);
        if (readout != null) readout.textContent = `${dials[dial.field] ?? dial.fallback}${dial.unit}`;
      }

      // The picker names the scheme on the page, so a lever dragged off a preset has to move it to
      // `custom` — a control still reading `slate` beside a scheme that is no longer slate is the
      // same silent disagreement the readouts exist to prevent. Painted onto the control and nowhere
      // else: which preset the dials name is derived, so it is never stored.
      const picked = matchPreset(dials)?.id ?? PRESET_CUSTOM;
      if (picker !== null && picker.value !== picked) picker.value = picked;

      // `schemeCss` rebuilds the whole stylesheet text, and the effect runs once per dial input —
      // so a drag paid for a dozen rebuilds nobody could read. Only the last one before paint is.
      pending = { generated, dials };
      if (frame === 0) frame = view.requestAnimationFrame(paintText);
    });

    return () => {
      unbind();
      if (frame !== 0) view.cancelAnimationFrame(frame);
      for (const property of written) html.style.removeProperty(property);
    };
  },
  on: {
    // What a preset *means* is two gray dials, and that translation is this page's business and not
    // the control's (`UI_SSR_COMPONENTS.md` §2a). It is a command, so it lives in the handler that
    // the pick fires: the painter above then moves the sliders and repaints, exactly as for a drag.
    [PRESET_ACTION]: ({ el, state }) => {
      const preset = SCHEME_PRESETS.find((candidate) => candidate.id === (el as ValueControl).value);
      if (preset === undefined) return;
      for (const field of PRESET_FIELDS) {
        const dial = state[field];
        if (dial !== undefined) dial.value = preset[field];
      }
    },
  },
});

// Keyed by the button it belongs to, the way `resume.ts` keys its own live-scope map. This module is
// browser-only, which `CODE_RULES.md` §1e exempts from the module-state prohibition.
const copyTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

// Lazy: the button stamps `data-on-click`, which is exactly what a lazy scope resumes on.
registerScope(COPY_SCOPE, {
  setup: () => () => {
    for (const timer of copyTimers.values()) clearTimeout(timer);
    copyTimers.clear();
  },
  on: {
    [COPY_ACTION]: ({ el }) => {
      const target = COPY_TARGETS.find((candidate) => candidate.id === el.getAttribute(COPY_TARGET_ATTR));
      if (target === undefined) return;
      const doc = ownerDocument(el);
      const label = el.querySelector<HTMLElement>(`[${COPY_LABEL_ATTR}]`);
      const status = doc.querySelector<HTMLElement>(`[${COPY_STATUS_ATTR}="${target.id}"]`);
      // Read off the DOM rather than recomputed from the dials, so what is copied is exactly what
      // the reader is looking at.
      const text = doc.querySelector(target.source)?.textContent ?? "";

      /** The label is left alone on failure: a control reading "Copied" over an empty clipboard is worse than one that says nothing. */
      const fail = () => {
        if (status !== null) status.textContent = target.failed;
      };

      const confirm = () => {
        if (label !== null) label.textContent = target.copied;
        if (status !== null) status.textContent = target.announce;
        const previous = copyTimers.get(el);
        if (previous !== undefined) clearTimeout(previous);
        copyTimers.set(
          el,
          setTimeout(() => {
            if (label !== null) label.textContent = target.label;
            copyTimers.delete(el);
          }, COPY_CONFIRM_MS),
        );
      };

      // `navigator.clipboard` is undefined in an insecure context, which every plain-HTTP deploy is.
      // There is no `execCommand` fallback: it is deprecated, and the failure message is honest.
      const clipboard = navigator.clipboard as Clipboard | undefined;
      if (clipboard === undefined || text === "") {
        fail();
        return;
      }
      // Both branches are handled, so nothing floats — the handler's own signature returns void.
      void clipboard.writeText(text).then(confirm, fail);
    },
  },
});

// Eager: a bound control stamps `data-field` and no `data-on-*`, so a lazy scope has nothing to
// resume on.
registerScope(CONTROLS_DEMO_SCOPE, {
  eager: true,
  setup: ({ root, state }) => {
    const signals = state as SignalRecord<Record<string, unknown>>;
    const unbind = bindControls(root, signals);
    const untext = bindText(root, signals, { format: controlsReadout });
    const unattr = bindAttr(root, signals);
    return () => {
      unattr();
      untext();
      unbind();
    };
  },
});

const toolbarPanel = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-ref='toolbar-panel']");

registerScope(SHOW_SCOPES.toolbar, {
  on: {
    fit: ({ root }) => {
      toolbarPanel(root)?.classList.toggle("max-w-xs");
    },
    toggle: ({ root }) => {
      const panel = toolbarPanel(root);
      if (panel) panel.hidden = !panel.hidden;
    },
    reset: ({ root }) => {
      const panel = toolbarPanel(root);
      if (!panel) return;
      panel.hidden = false;
      panel.classList.add("max-w-xs");
    },
    closeOptions: ({ root }) => {
      root.querySelector<HTMLElement>("[data-slot~='toolbar-flyout']")?.hidePopover();
    },
  },
});

registerScope(SHOW_SCOPES.navbar, {
  on: {
    setFilters: ({ el }) => {
      const tokens = (el.dataset.filters ?? "").split(/\s+/).filter(Boolean);
      ownerDocument(el).dispatchEvent(new CustomEvent(NAVBAR_FILTERS_EVENT, { detail: tokens }));
    },
  },
});

registerScope(SHOW_SCOPES.filter, {
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

// Eager because the deferral belongs to the module, not the scope: the observer has to be
// watching before the panel is scrolled to, and `lazy` owns the waiting from there.
registerScope(LAZY_DEMO_SCOPE, {
  eager: true,
  setup: ({ root }) => {
    const stopDemo = lazy({ ref: LAZY_DEMO_REF, within: root, load: () => import("./lazy-panel"), init: (mod, el) => mod.mountLazyPanel(el) });

    // A `load` that rejects its first attempts, so the retry path the prose describes is a path the
    // page actually walks. The counter is written from `onError`, which is the only place a caller
    // learns an attempt failed at all.
    let attempt = 0;
    const status = root.querySelector(`[data-ref='${LAZY_RETRY_STATUS_REF}']`);
    const stopRetry = lazy({
      ref: LAZY_RETRY_REF,
      within: root,
      load: () => {
        attempt += 1;
        return attempt > LAZY_RETRY_FAILURES ? import("./lazy-panel") : Promise.reject(new Error(`[show] rejected attempt ${attempt}`));
      },
      init: (mod, el) => mod.mountRetryPanel(el),
      onError: () => {
        if (status !== null) status.textContent = lazyRetryAttempt(attempt);
      },
    });

    return () => {
      stopDemo();
      stopRetry();
    };
  },
});
