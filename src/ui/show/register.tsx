/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { createController } from "@remix-run/fetch-router";
import { get, post } from "@remix-run/fetch-router/routes";

import { defineAction } from "../../app/action";
import type { Forge } from "../../app/forge-app";
import { definePage } from "../../app/page";
import { renderShell } from "../../app/shell";
import type { AppContext } from "../../context/types";
import { v } from "../../validation/validation";
import type { ForgeIcon } from "../core/icon";
import { ShowcaseContent, SHOWCASE_PAGES, type ShowcasePage } from "./components";
import { CustomiseContent, type CustomiseData, loadCustomise } from "./customise";
import type { ShowcaseData } from "./route";
import {
  loadDependent,
  loadPaginate,
  loadPreview,
  loadSearch,
  loadShowcase,
  loadToast,
  loadValidate,
  renderAvatar,
  renderDependent,
  renderPaginate,
  renderPreview,
  renderSearch,
  renderToast,
  renderTurnstileVerdict,
  renderValidate,
  showcasePaths,
} from "./route";

/** Icon constraint covering all showcase sections — pass your app's icon component. @public */
export type ShowcaseIcon = ForgeIcon<
  | "spinner"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "sun"
  | "moon"
  | "monitor"
  | "hamburger"
  | "close"
  | "panel-open"
  | "panel-close"
  | "upload"
>;

/** The playground form's only declared field; the pipeline drops the token itself. */
const TURNSTILE_VERIFY_SCHEMA = v.strictObject({ email: v.optional(v.string()) });

/** Builds the showcase route subtree under `base` (defaults to `"/showcase/ui"`). @public */
export function showcaseRoutes(base = "/showcase/ui") {
  const api = `${base}/api`;
  return {
    ui: {
      index: get(base),
      interactive: get(`${base}/interactive`),
      turnstile: get(`${base}/turnstile`),
      runtime: get(`${base}/runtime`),
      htmx: get(`${base}/htmx`),
      chrome: get(`${base}/chrome`),
      theme: get(`${base}/theme`),
      api: {
        preview: get(`${api}/preview`),
        validate: get(`${api}/validate`),
        search: get(`${api}/search`),
        paginate: get(`${api}/paginate`),
        dependent: get(`${api}/dependent`),
        toast: get(`${api}/toast`),
        avatar: get(`${api}/avatar`),
        turnstileVerify: post(`${api}/turnstile-verify`),
      },
    },
  };
}

/** The `ui` subtree returned by `showcaseRoutes` — pass this to `registerShowcase`. @public */
export type ShowcaseUiRoutes = ReturnType<typeof showcaseRoutes>["ui"];

/** Options for `registerShowcase`. @public */
export interface ShowcaseOptions<Bindings extends object, Config> {
  /** Icon component used across preview, dependent, and content sections. */
  icon: ShowcaseIcon;
  /** Siteverify secret for the Turnstile page's verification panel; without it nothing is sent to Cloudflare. */
  turnstileSecret?: (c: AppContext<Bindings>, config: Config) => string | Promise<string>;
}

/** Registers every showcase route, including the seven API endpoints, on `app`. @public */
export function registerShowcase<Bindings extends object, Config>(
  app: Forge<Bindings>,
  uiRoutes: ShowcaseUiRoutes,
  opts: ShowcaseOptions<Bindings, Config>,
): void {
  const basePath = uiRoutes.index.href();
  const apiPath = `${basePath}/api`;
  const paths = showcasePaths(basePath, apiPath);

  const contentPage = (page: ShowcasePage) =>
    definePage<Bindings, Config, ShowcaseData>({
      loader: (c) => loadShowcase(c, { basePath, apiPath }),
      view: (c, _config, state) =>
        renderShell(c, <ShowcaseContent data={state.data} icon={opts.icon} page={page} />, {
          mount: "showcase",
          page,
          meta: { title: SHOWCASE_PAGES[page].label, robots: "noindex" },
        }),
    });

  const preview = definePage({ loader: loadPreview, view: (_c, _cfg, state) => renderPreview(state.data, opts.icon) });

  const validate = definePage({ loader: (c) => loadValidate(c, paths), view: (_c, _cfg, state) => renderValidate(state.data, opts.icon) });

  const search = definePage({ loader: loadSearch, view: (_c, _cfg, state) => renderSearch(state.data) });

  const paginate = definePage({ loader: (c) => loadPaginate(c, paths), view: (_c, _cfg, state) => renderPaginate(state.data) });

  const dependent = definePage({ loader: loadDependent, view: (_c, _cfg, state) => renderDependent(state.data, opts.icon) });

  const toast = definePage({ loader: loadToast, view: (_c, _cfg, state) => renderToast(state.data) });

  const avatar = definePage({ view: () => renderAvatar() });

  const secretKey = opts.turnstileSecret;
  const turnstileVerify = defineAction<typeof TURNSTILE_VERIFY_SCHEMA, Bindings, Config>({
    schema: TURNSTILE_VERIFY_SCHEMA,
    ...(secretKey === undefined ? {} : { turnstile: { secretKey, verify: (c: AppContext<Bindings>) => ({ expectedHostname: c.url.hostname }) } }),
    // The one place a showcase departs from a real route: an app answers every guard the same way,
    // so a bot cannot read off which one spoke. Naming it is the whole point of this page.
    onBotDetected: (rejection) => renderTurnstileVerdict({ kind: "rejected", guard: "turnstile", reason: rejection.reason }),
    handle: () => renderTurnstileVerdict(secretKey === undefined ? { kind: "unconfigured" } : { kind: "verified" }),
  });

  const themePath = uiRoutes.theme.href();
  const theme = definePage<Bindings, Config, CustomiseData>({
    loader: (c) => loadCustomise(c, { path: themePath }),
    view: (c, _config, state) =>
      renderShell(c, <CustomiseContent data={state.data} icon={opts.icon} />, {
        mount: "showcase",
        page: "theme",
        meta: { title: "Theme", robots: "noindex" },
      }),
  });

  const actions = {
    index: contentPage("index"),
    interactive: contentPage("interactive"),
    runtime: contentPage("runtime"),
    htmx: contentPage("htmx"),
    turnstile: contentPage("turnstile"),
    chrome: contentPage("chrome"),
    theme,
  };

  app.map(uiRoutes, createController(uiRoutes, { actions }));
  app.map(
    uiRoutes.api,
    createController(uiRoutes.api, { actions: { preview, validate, search, paginate, dependent, toast, avatar, turnstileVerify } }),
  );
}
