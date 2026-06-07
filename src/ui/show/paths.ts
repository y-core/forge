/** URL paths for the showcase module — single source of truth so the page and controller never drift. @public */
export interface ShowcasePaths {
  page: string;
  preview: string;
  validate: string;
  search: string;
  paginate: string;
  dependent: string;
  toast: string;
}

/** Returns all showcase paths derived from a single base path. @public */
export function showcasePaths(basePath: string): ShowcasePaths {
  const base = basePath.replace(/\/$/, "");
  return {
    page: base,
    preview: `${base}/preview`,
    validate: `${base}/validate`,
    search: `${base}/search`,
    paginate: `${base}/paginate`,
    dependent: `${base}/dependent`,
    toast: `${base}/toast`,
  };
}
