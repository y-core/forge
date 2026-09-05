/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { AppContext } from "../../context/types";
import { joinPath } from "../../http/path";
import { fragmentResponse } from "../../http/response";
import { renderToString } from "../../jsx/render-to-string";
import type { ForgeIcon } from "../core/icon";
import { DependentFragment, PaginateFragment, PreviewFragment, SearchFragment, ToastFragment, ValidateFragment } from "./sections";
import { loadTurnstileOptions, type TurnstileDemoOptions, type TurnstileVerdict, TurnstileVerdictFragment } from "./turnstile-demo";

/** URL paths for the showcase module — single source of truth so page and controller never drift. @public */
export interface ShowcasePaths {
  page: string;
  preview: string;
  validate: string;
  search: string;
  paginate: string;
  dependent: string;
  toast: string;
  avatar: string;
  turnstile: string;
  turnstileVerify: string;
}

/** Returns all showcase paths derived from a base path. Pass `apiPath` to serve API
 * endpoints under a different prefix than the page. @public */
export function showcasePaths(basePath: string, apiPath?: string): ShowcasePaths {
  const page = joinPath(basePath);
  const api = joinPath(apiPath ?? basePath);
  return {
    page,
    preview: joinPath(api, "preview"),
    validate: joinPath(api, "validate"),
    search: joinPath(api, "search"),
    paginate: joinPath(api, "paginate"),
    dependent: joinPath(api, "dependent"),
    toast: joinPath(api, "toast"),
    avatar: joinPath(api, "avatar"),
    turnstile: joinPath(page, "turnstile"),
    turnstileVerify: joinPath(api, "turnstile-verify"),
  };
}

/** Data returned by `loadShowcase`. @public */
export interface ShowcaseData {
  paths: ShowcasePaths;
  turnstile: TurnstileDemoOptions;
}

/** Loader for the main showcase page. @public */
export function loadShowcase<Bindings = Record<string, unknown>>(
  c: AppContext<Bindings>,
  opts: { basePath?: string; apiPath?: string } = {},
): ShowcaseData {
  return { paths: showcasePaths(opts.basePath ?? "/showcase", opts.apiPath), turnstile: loadTurnstileOptions(c.url.searchParams) };
}

/** @public */
export interface PreviewData {
  tone: string;
  appearance: string;
  size: string;
}

/** Reads the preview fragment's tone, appearance and size from the query string. @public */
export function loadPreview<Bindings = Record<string, unknown>>(c: AppContext<Bindings>): PreviewData {
  const q = c.url.searchParams;
  return { tone: q.get("tone") ?? "primary", appearance: q.get("appearance") ?? "solid", size: q.get("size") ?? "md" };
}

/** @public */
export async function renderPreview(
  data: PreviewData,
  icon: ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor">,
): Promise<Response> {
  const body = await renderToString(<PreviewFragment data={data} icon={icon} />);
  return fragmentResponse(body);
}

/** @public */
export interface ValidateData {
  email: string;
  paths: ShowcasePaths;
}

/** Reads the email under validation from the query string. @public */
export function loadValidate<Bindings = Record<string, unknown>>(c: AppContext<Bindings>, paths: ShowcasePaths): ValidateData {
  return { email: c.url.searchParams.get("email") ?? "", paths };
}

/** @public */
export async function renderValidate(data: ValidateData, icon: ForgeIcon<"close">): Promise<Response> {
  const body = await renderToString(<ValidateFragment data={data} icon={icon} />);
  return fragmentResponse(body);
}

/** @public */
export interface SearchData {
  q: string;
}

/** Reads the search term from the query string. @public */
export function loadSearch<Bindings = Record<string, unknown>>(c: AppContext<Bindings>): SearchData {
  return { q: c.url.searchParams.get("q") ?? "" };
}

/** @public */
export async function renderSearch(data: SearchData): Promise<Response> {
  const body = await renderToString(<SearchFragment data={data} />);
  return fragmentResponse(body);
}

/** @public */
export interface PaginateData {
  page: number;
  paths: ShowcasePaths;
}

/** Reads the requested page number from the query string, clamped to at least 1. @public */
export function loadPaginate<Bindings = Record<string, unknown>>(c: AppContext<Bindings>, paths: ShowcasePaths): PaginateData {
  const raw = c.url.searchParams.get("page");
  // `Math.max` propagates NaN, so `?page=abc` used to render an empty tbody, hide *both* pager
  // buttons and print "Page NaN of 4". The parse has to be tested, not merely clamped.
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  const page = Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
  return { page, paths };
}

/** @public */
export async function renderPaginate(data: PaginateData): Promise<Response> {
  const body = await renderToString(<PaginateFragment data={data} />);
  return fragmentResponse(body);
}

/** @public */
export interface DependentData {
  category: string;
}

/** Reads the selected category from the query string. @public */
export function loadDependent<Bindings = Record<string, unknown>>(c: AppContext<Bindings>): DependentData {
  return { category: c.url.searchParams.get("category") ?? "fruit" };
}

/** @public */
export async function renderDependent(
  data: DependentData,
  icon: ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor">,
): Promise<Response> {
  const body = await renderToString(<DependentFragment data={data} icon={icon} />);
  return fragmentResponse(body);
}

/** @public */
export interface ToastData {
  type: string;
}

/** Reads the toast variant to demonstrate from the query string. @public */
export function loadToast<Bindings = Record<string, unknown>>(c: AppContext<Bindings>): ToastData {
  return { type: c.url.searchParams.get("type") ?? "success" };
}

/** @public */
export async function renderToast(data: ToastData): Promise<Response> {
  const body = await renderToString(<ToastFragment data={data} />);
  return fragmentResponse(body);
}

/** Renders the verdict the Turnstile verify action reached. @public */
export async function renderTurnstileVerdict(verdict: TurnstileVerdict): Promise<Response> {
  const body = await renderToString(<TurnstileVerdictFragment verdict={verdict} />);
  return fragmentResponse(body, verdict.kind === "rejected" ? 422 : 200);
}

const AVATAR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Portrait">' +
  '<rect width="64" height="64" fill="#6d8bb8"/>' +
  '<circle cx="32" cy="24" r="12" fill="#f2e2d2"/>' +
  '<path d="M8 64a24 24 0 0 1 48 0Z" fill="#f2e2d2"/>' +
  "</svg>";

/** Serves the showcase's own avatar portrait, so the catalog never reaches for a remote image. @public */
export function renderAvatar(): Response {
  return new Response(AVATAR_SVG, { headers: { "content-type": "image/svg+xml" } });
}
