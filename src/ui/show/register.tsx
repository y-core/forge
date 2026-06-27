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
import { ShowcaseContent } from "./components";
import type { ShowcaseData } from "./route";
import {
  loadDependent,
  loadPaginate,
  loadPreview,
  loadSearch,
  loadShowcase,
  loadToast,
  loadValidate,
  renderDependent,
  renderPaginate,
  renderPreview,
  renderSearch,
  renderToast,
  renderValidate,
  showcasePaths,
} from "./route";

/** Icon constraint covering all showcase sections — pass your app's icon component. @public */
export type ShowcaseIcon = ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor" | "hamburger" | "close">;

/**
 * Builds the showcase route subtree under `base` (defaults to `"/showcase/ui"`).
 * Assign the return value to your `routes` object, then pass `routes.showcase.ui`
 * to `registerShowcase`.
 * @public
 */
export function showcaseRoutes(base = "/showcase/ui") {
  const api = `${base}/api`;
  return {
    ui: {
      index: get(base),
      api: {
        preview: get(`${api}/preview`),
        validate: get(`${api}/validate`),
        search: get(`${api}/search`),
        paginate: get(`${api}/paginate`),
        dependent: get(`${api}/dependent`),
        toast: get(`${api}/toast`),
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
  /**
   * Async context factory called per request. The resolved value is forwarded as the `ctx` prop
   * to `layout`.
   */
  context: (c: AppContext<Bindings>, config: Config) => Promise<Ctx>;
  /**
   * Layout component that wraps the showcase page. Receives `ctx` from `context` and the
   * showcase content as `children`.
   * @example
   * ```ts
   * layout: Layout  // FC<{ ctx: MyRenderContext }>
   * ```
   */
  layout: FC<{ ctx: Ctx }>;
}

/**
 * Registers all showcase routes on `app`.
 *
 * The six HTMX API sub-routes (preview, validate, search, paginate, dependent, toast) are wired
 * automatically. Provide `context` (a per-request async factory) and `layout` (a component that
 * wraps the page content as children) to render the main showcase page inside your app's chrome.
 *
 * @example
 * ```ts
 * // routes.ts
 * showcase: showcaseRoutes("/showcase/ui"),
 *
 * // router.ts
 * registerShowcase(app, routes.showcase.ui, {
 *   icon: MyIcon,
 *   context: renderContext,
 *   layout: Layout,
 * });
 * ```
 * @public
 */
export function registerShowcase<Bindings extends object, Config, Ctx>(
  app: Forge<Bindings>,
  uiRoutes: ShowcaseUiRoutes,
  opts: ShowcaseOptions<Bindings, Config, Ctx>,
): void {
  const basePath = uiRoutes.index.href();
  const apiPath = `${basePath}/api`;
  const paths = showcasePaths(basePath, apiPath);

  const LayoutComponent = opts.layout;

  const index = definePage<Bindings, Config, ShowcaseData>({
    loader: (c) => loadShowcase(c, { basePath, apiPath }),
    view: async (c, config, state) => {
      const ctx = await opts.context(c, config);
      return renderPage(
        <LayoutComponent ctx={ctx}>
          <ShowcaseContent data={state.data} icon={opts.icon} />
        </LayoutComponent>,
      );
    },
  });

  const preview = definePage({ loader: loadPreview, view: (_c, _cfg, state) => renderPreview(state.data, opts.icon) });

  const validate = definePage({ loader: loadValidate, view: (_c, _cfg, state) => renderValidate(state.data) });

  const search = definePage({ loader: loadSearch, view: (_c, _cfg, state) => renderSearch(state.data) });

  const paginate = definePage({ loader: (c) => loadPaginate(c, paths), view: (_c, _cfg, state) => renderPaginate(state.data) });

  const dependent = definePage({ loader: loadDependent, view: (_c, _cfg, state) => renderDependent(state.data, opts.icon) });

  const toast = definePage({ loader: loadToast, view: (_c, _cfg, state) => renderToast(state.data) });

  app.map(uiRoutes, createController(uiRoutes, { actions: { index } }));
  app.map(uiRoutes.api, createController(uiRoutes.api, { actions: { preview, validate, search, paginate, dependent, toast } }));
}
