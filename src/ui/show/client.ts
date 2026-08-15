import { bindField } from "../client/bind";
import { elementById, ownerDocument } from "../client/dom";
import { openPopoverAt } from "../client/popover-anchor";
import { registerScope } from "../client/resume";
import { mountScrollSpy } from "../client/scroll-spy";
import { computed, effect } from "../client/signal";
import { mountTurnstile } from "../client/turnstile";
import {
  buildTheme,
  CUSTOMISE_SCOPE,
  DIALS,
  type DialValues,
  dialQuery,
  HEX_ATTR,
  liveRatios,
  matchPreset,
  PRESET_CUSTOM,
  PRESET_FIELD,
  PRESET_FIELDS,
  RADIUS_PROPERTY,
  SCALE_ROW_ATTR,
  SCALE_ROWS,
  SCHEME_PRESETS,
  scaleVars,
  schemeCss,
} from "../contracts/theme-contract";

// Eager: `contextmenu` is not a delegated `SCOPE_EVENT`, so there is no `data-on-*` in the markup
// for a lazy scope to resume on.
registerScope("show-context-menu", {
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

registerScope("show-toc", { eager: true, setup: ({ root }) => mountScrollSpy({ root }) });

registerScope("show-turnstile", { eager: true, setup: ({ root }) => mountTurnstile(root) });

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
    const sliders = new Map(DIALS.map((dial) => [dial.field, root.querySelector<HTMLInputElement>(`input[data-field="${dial.field}"]`)]));
    const picker = root.querySelector<HTMLSelectElement>(`select[data-field="${PRESET_FIELD}"]`);

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

      // One value per property, both modes inside it: the browser picks the branch, so nothing here
      // has to notice the theme toggle rewriting `<html>`'s class list.
      for (const [name, value] of scaleVars("gray", generated.gray)) set(html, name, value);
      for (const [name, value] of scaleVars("accent", generated.accent)) set(html, name, value);
      set(html, RADIUS_PROPERTY, `${dials.radius ?? 10}px`);

      // Each row is painted on its own element: the semantic tokens compute on `:root` and inherit
      // as literals, so a nested `.dark` class could never give one row the other mode's scale.
      for (const { row, cells, swatches, hexes } of rows) {
        const scale = generated.gray[row.mode].solid;

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
        const value = dials[dial.field] ?? dial.fallback;
        const readout = readouts.get(dial.field);
        if (readout != null) readout.textContent = `${value}${dial.unit}`;
        // `bindField` is one-way, DOM to signal, so a dial moved by anything but its own slider — the
        // preset effect above — leaves the thumb behind unless the app puts it back. Writing the value
        // the slider already holds is a no-op, so this does not fight a drag in progress.
        const slider = sliders.get(dial.field);
        if (slider != null && slider.value !== String(value)) slider.value = String(value);
      }

      // The picker names the scheme on the page, so a lever dragged off a preset has to move it to
      // `custom` — a control still reading `slate` beside a scheme that is no longer slate is the
      // same silent disagreement the readouts exist to prevent. The signal is written back beside the
      // control: one still reading `slate` would swallow the next pick of the scheme just left,
      // `createSignal` notifying only on a real change.
      const picked = matchPreset(dials)?.id ?? PRESET_CUSTOM;
      if (picker !== null && picker.value !== picked) picker.value = picked;
      const chosen = state[PRESET_FIELD];
      if (chosen !== undefined) chosen.value = picked;

      const output = doc.querySelector("[data-scheme-output] code");
      if (output !== null) output.textContent = schemeCss(generated, dials);

      const share = doc.querySelector("[data-share-url]");
      if (share !== null) share.textContent = `${doc.location.pathname}?${dialQuery(dials)}`;
    });

    // What a preset *means* is two gray dials, and that translation is this page's business and not
    // the control's (`UI_SSR_COMPONENTS.md` §2a). It writes the signals and stops there — the effect
    // above moves the sliders and repaints, exactly as it does for a drag.
    const stopPreset = effect(() => {
      const picked = String(state[PRESET_FIELD]?.value ?? PRESET_CUSTOM);
      const preset = SCHEME_PRESETS.find((candidate) => candidate.id === picked);
      if (preset === undefined) return;
      for (const field of PRESET_FIELDS) {
        const dial = state[field];
        if (dial !== undefined) dial.value = preset[field];
      }
    });

    return () => {
      stop();
      stopPreset();
      for (const property of written) html.style.removeProperty(property);
    };
  },
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
