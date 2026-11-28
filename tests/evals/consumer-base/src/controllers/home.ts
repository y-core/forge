import { renderPage } from "@y-core/forge/render/jsx";

import { definePage } from "../app/handlers";
import { routes } from "../routes";
import { siteSummary } from "../services/site";
import { HomeView } from "../views/home";

export const homePage = definePage(routes.home, {
  loader: async (c, config) => siteSummary(c.env.DB, config.siteName),
  view: (_c, _config, state) => renderPage(HomeView({ site: state.data })),
});
