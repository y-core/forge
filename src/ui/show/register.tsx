/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { createController } from "@remix-run/fetch-router";
import { get } from "@remix-run/fetch-router/routes";
import type { Forge } from "../../app/forge-app";
import { definePage } from "../../app/page";
import type { AppContext } from "../../context/types";
import { renderPage } from "../../jsx/render-to-string";
import type { FC } from "../../jsx/types";
import type { ForgeIcon } from "../core/icon";
import { ShowcaseContent, type ShowcasePage } from "./components";
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
  renderValidate,
  showcasePaths,
} from "./route";

/** Icon constraint covering all showcase sections — pass your app's icon component. @public */
export type ShowcaseIcon = ForgeIcon<
  "spinner" | "chevron-down" | "sun" | "moon" | "monitor" | "hamburger" | "close" | "panel-open" | "panel-close"
>;

/** Builds the showcase route subtree under `base` (defaults to `"/showcase/ui"`). @public */
export function showcaseRoutes(base = "/showcase/ui") {
  const api = `${base}/api`;
  return {
    ui: {
      index: get(base),
      interactive: get(`${base}/interactive`),
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
      },
    },
  };
}

/** The `ui` subtree returned by `showcaseRoutes` — pass this to `registerShowcase`. @public */
export type ShowcaseUiRoutes = ReturnType<typeof showcaseRoutes>["ui"];

/** Options for `registerShowcase`. @public */
export interface ShowcaseOptions<Bindings extends object, Config, Ctx> {
  /** Icon component used across preview, dependent, and content sections. */
  icon: ShowcaseIcon;
  /** Async context factory called per request; its value is forwarded as `layout`'s `ctx` prop. */
  context: (c: AppContext<Bindings>, config: Config) => Promise<Ctx>;
  /** Layout component that wraps the showcase page content as `children`. */
  layout: FC<{ ctx: Ctx }>;
}

/** Registers every showcase route, including the seven API endpoints, on `app`. @public */
export function registerShowcase<Bindings extends object, Config, Ctx>(
  app: Forge<Bindings>,
  uiRoutes: ShowcaseUiRoutes,
  opts: ShowcaseOptions<Bindings, Config, Ctx>,
): void {
  const basePath = uiRoutes.index.href();
  const apiPath = `${basePath}/api`;
  const paths = showcasePaths(basePath, apiPath);

  const LayoutComponent = opts.layout;

  const contentPage = (page: ShowcasePage) =>
    definePage<Bindings, Config, ShowcaseData>({
      loader: (c) => loadShowcase(c, { basePath, apiPath }),
      view: async (c, config, state) => {
        const ctx = await opts.context(c, config);
        return renderPage(
          <LayoutComponent ctx={ctx}>
            <ShowcaseContent data={state.data} icon={opts.icon} page={page} />
          </LayoutComponent>,
        );
      },
    });

  const preview = definePage({ loader: loadPreview, view: (_c, _cfg, state) => renderPreview(state.data, opts.icon) });

  const validate = definePage({ loader: (c) => loadValidate(c, paths), view: (_c, _cfg, state) => renderValidate(state.data, opts.icon) });

  const search = definePage({ loader: loadSearch, view: (_c, _cfg, state) => renderSearch(state.data) });

  const paginate = definePage({ loader: (c) => loadPaginate(c, paths), view: (_c, _cfg, state) => renderPaginate(state.data) });

  const dependent = definePage({ loader: loadDependent, view: (_c, _cfg, state) => renderDependent(state.data, opts.icon) });

  const toast = definePage({ loader: loadToast, view: (_c, _cfg, state) => renderToast(state.data) });

  const avatar = definePage({ view: () => renderAvatar() });

  const themePath = uiRoutes.theme.href();
  const theme = definePage<Bindings, Config, CustomiseData>({
    loader: (c) => loadCustomise(c, { path: themePath }),
    view: async (c, config, state) => {
      const ctx = await opts.context(c, config);
      return renderPage(
        <LayoutComponent ctx={ctx}>
          <CustomiseContent data={state.data} icon={opts.icon} />
        </LayoutComponent>,
      );
    },
  });

  const actions = {
    index: contentPage("index"),
    interactive: contentPage("interactive"),
    runtime: contentPage("runtime"),
    htmx: contentPage("htmx"),
    chrome: contentPage("chrome"),
    theme,
  };

  app.map(uiRoutes, createController(uiRoutes, { actions }));
  app.map(uiRoutes.api, createController(uiRoutes.api, { actions: { preview, validate, search, paginate, dependent, toast, avatar } }));
}
