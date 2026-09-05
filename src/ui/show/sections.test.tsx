/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { showcasePaths } from "./route";
import {
  DependentFragment,
  DependentSection,
  PaginateFragment,
  PaginateSection,
  PreviewFragment,
  PreviewSection,
  SearchFragment,
  SearchSection,
  ToastFragment,
  ToastSection,
  ValidateFragment,
  ValidateSection,
} from "./sections";

// oxlint-disable-next-line typescript/no-explicit-any -- test-only stub
const StubIcon = ((_props: any) => null) as any;
StubIcon.sprite = "/icons.svg";
// oxlint-disable-next-line typescript/no-explicit-any -- test-only stub
const icon = StubIcon as any;

const paths = showcasePaths("/showcase");

const DEMO_SECTION_CLASS = 'class="scroll-mt-24 space-y-4 rounded-2xl border border-border bg-card p-6"';

const openTagWithId = (html: string, id: string) => new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0] ?? "";

const rootTag = (html: string) => /^<[a-z]+\b[^>]*>/.exec(html)?.[0] ?? "";

const textsOf = (html: string, tag: string) =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>[^]*?([^<>]*)</${tag}>`, "g"))].map(([, text]) => text);

describe("show fragments", () => {
  it("PreviewFragment renders the preview swap target", async () => {
    const out = await render(<PreviewFragment data={{ tone: "primary", appearance: "solid", size: "md" }} icon={icon} />);
    expect(openTagWithId(out, "show-preview-button")).toBe(
      '<div id="show-preview-button" class="flex items-center justify-center rounded-box border border-border bg-muted p-8">',
    );
    expect(textsOf(out, "button")).toEqual(["Preview"]);
  });

  it("ValidateFragment renders the validate field target", async () => {
    const out = await render(<ValidateFragment data={{ email: "", paths }} icon={icon} />);
    expect(openTagWithId(out, "show-validate-field")).toBe(
      '<fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-destructive-text flex-col [&amp;&gt;*]:w-full" id="show-validate-field">',
    );
  });

  it("SearchFragment renders the search results target", async () => {
    const out = await render(<SearchFragment data={{ q: "" }} />);
    expect(openTagWithId(out, "show-search-results")).toBe('<ul id="show-search-results" class="grid grid-cols-2 gap-2 sm:grid-cols-3">');
  });

  it("PaginateFragment renders the paginate table target", async () => {
    const out = await render(<PaginateFragment data={{ page: 1, paths }} />);
    expect(openTagWithId(out, "show-paginate-table")).toBe('<div id="show-paginate-table">');
  });

  it("DependentFragment renders the dependent select target", async () => {
    const out = await render(<DependentFragment data={{ category: "fruit" }} icon={icon} />);
    expect(openTagWithId(out, "show-dependent-select")).toBe(
      '<fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full data-[invalid]:text-destructive-text flex-col [&amp;&gt;*]:w-full gap-1.5" id="show-dependent-select">',
    );
  });

  it("ToastFragment renders an OOB flash targeting the flash container", async () => {
    const out = await render(<ToastFragment data={{ type: "success" }} />);
    expect(rootTag(out)).toBe('<div hx-swap-oob="beforeend:#flash-container">');
  });
});

describe("show sections", () => {
  it("PreviewSection renders its demo section", async () => {
    const out = await render(<PreviewSection paths={paths} icon={icon} />);
    expect(openTagWithId(out, "demo-preview")).toBe(`<section id="demo-preview" ${DEMO_SECTION_CLASS}>`);
    expect(textsOf(out, "h2")).toEqual(["Live Preview"]);
  });

  it("ValidateSection renders its demo section", async () => {
    const out = await render(<ValidateSection paths={paths} icon={icon} />);
    expect(openTagWithId(out, "demo-validate")).toBe(`<section id="demo-validate" ${DEMO_SECTION_CLASS}>`);
    expect(textsOf(out, "h2")).toEqual(["Inline Validation"]);
  });

  it("SearchSection renders its demo section", async () => {
    const out = await render(<SearchSection paths={paths} />);
    expect(openTagWithId(out, "demo-search")).toBe(`<section id="demo-search" ${DEMO_SECTION_CLASS}>`);
    expect(textsOf(out, "h2")).toEqual(["Live Search"]);
  });

  it("PaginateSection renders its demo section", async () => {
    const out = await render(<PaginateSection paths={paths} />);
    expect(openTagWithId(out, "demo-paginate")).toBe(`<section id="demo-paginate" ${DEMO_SECTION_CLASS}>`);
    expect(textsOf(out, "h2")).toEqual(["Paginated Table"]);
  });

  it("DependentSection renders its demo section", async () => {
    const out = await render(<DependentSection paths={paths} icon={icon} />);
    expect(openTagWithId(out, "demo-dependent")).toBe(`<section id="demo-dependent" ${DEMO_SECTION_CLASS}>`);
    expect(textsOf(out, "h2")).toEqual(["Dependent Select"]);
  });

  it("ToastSection renders its demo section", async () => {
    const out = await render(<ToastSection paths={paths} />);
    expect(openTagWithId(out, "demo-toast")).toBe(`<section id="demo-toast" ${DEMO_SECTION_CLASS}>`);
    expect(textsOf(out, "h2")).toEqual(["Flash Toast (OOB)"]);
  });
});
