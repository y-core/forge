/** @jsxImportSource @y-core/forge */

import type { AppContext } from "../../context/types";
import { fragmentResponse } from "../../http/response";
import { renderToString } from "../../jsx/render-to-string";
import type { ForgeIcon } from "../core/icon";
import { DependentFragment, PaginateFragment, PreviewFragment, SearchFragment, ToastFragment, ValidateFragment } from "./demos";
import type { ShowcasePaths } from "./paths";
import { showcasePaths } from "./paths";

// ─── ShowcaseData ────────────────────────────────────────────────────────────

/** Data returned by `loadShowcase`. @public */
export interface ShowcaseData {
  paths: ShowcasePaths;
}

/** Loader for the main showcase page. @public */
export function loadShowcase<Bindings = Record<string, unknown>>(_c: AppContext<Bindings>, opts: { basePath?: string } = {}): ShowcaseData {
  return { paths: showcasePaths(opts.basePath ?? "/showcase") };
}

// ─── Preview ─────────────────────────────────────────────────────────────────

/** @public */
export interface PreviewData {
  variant: string;
  size: string;
}

/** @public */
export function loadPreview<Bindings = Record<string, unknown>>(c: AppContext<Bindings>): PreviewData {
  return { variant: c.url.searchParams.get("variant") ?? "primary", size: c.url.searchParams.get("size") ?? "md" };
}

/** @public */
export async function renderPreview(
  data: PreviewData,
  icon: ForgeIcon<"spinner" | "chevron-down" | "sun" | "moon" | "monitor">,
): Promise<Response> {
  const body = await renderToString(<PreviewFragment data={data} icon={icon} />);
  return fragmentResponse(body);
}

// ─── Validate ────────────────────────────────────────────────────────────────

/** @public */
export interface ValidateData {
  email: string;
}

/** @public */
export function loadValidate<Bindings = Record<string, unknown>>(c: AppContext<Bindings>): ValidateData {
  return { email: c.url.searchParams.get("email") ?? "" };
}

/** @public */
export async function renderValidate(data: ValidateData): Promise<Response> {
  const body = await renderToString(<ValidateFragment data={data} />);
  return fragmentResponse(body);
}

// ─── Search ──────────────────────────────────────────────────────────────────

/** @public */
export interface SearchData {
  q: string;
}

/** @public */
export function loadSearch<Bindings = Record<string, unknown>>(c: AppContext<Bindings>): SearchData {
  return { q: c.url.searchParams.get("q") ?? "" };
}

/** @public */
export async function renderSearch(data: SearchData): Promise<Response> {
  const body = await renderToString(<SearchFragment data={data} />);
  return fragmentResponse(body);
}

// ─── Paginate ────────────────────────────────────────────────────────────────

/** @public */
export interface PaginateData {
  page: number;
  paths: ShowcasePaths;
}

/** @public */
export function loadPaginate<Bindings = Record<string, unknown>>(c: AppContext<Bindings>, paths: ShowcasePaths): PaginateData {
  const raw = c.url.searchParams.get("page");
  const page = raw ? Math.max(1, Number.parseInt(raw, 10)) : 1;
  return { page, paths };
}

/** @public */
export async function renderPaginate(data: PaginateData): Promise<Response> {
  const body = await renderToString(<PaginateFragment data={data} />);
  return fragmentResponse(body);
}

// ─── Dependent ───────────────────────────────────────────────────────────────

/** @public */
export interface DependentData {
  category: string;
}

/** @public */
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

// ─── Toast ───────────────────────────────────────────────────────────────────

/** @public */
export interface ToastData {
  type: string;
}

/** @public */
export function loadToast<Bindings = Record<string, unknown>>(c: AppContext<Bindings>): ToastData {
  return { type: c.url.searchParams.get("type") ?? "success" };
}

/** @public */
export async function renderToast(data: ToastData): Promise<Response> {
  const body = await renderToString(<ToastFragment data={data} />);
  return fragmentResponse(body);
}
