/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
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

// Minimal icon compatible with ForgeIcon<…>; renders nothing.
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const StubIcon = ((_props: any) => null) as any;
StubIcon.sprite = "/icons.svg";
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const icon = StubIcon as any;

const paths = showcasePaths("/showcase");

describe("show fragments", () => {
  it("PreviewFragment renders the preview swap target", async () => {
    const out = await render(<PreviewFragment data={{ variant: "primary", size: "md" }} icon={icon} />);
    expect(out).toContain('id="show-preview-button"');
    expect(out).toContain("Preview");
  });

  it("ValidateFragment renders the validate field target", async () => {
    const out = await render(<ValidateFragment data={{ email: "" }} />);
    expect(out).toContain('id="show-validate-field"');
  });

  it("SearchFragment renders the search results target", async () => {
    const out = await render(<SearchFragment data={{ q: "" }} />);
    expect(out).toContain('id="show-search-results"');
  });

  it("PaginateFragment renders the paginate table target", async () => {
    const out = await render(<PaginateFragment data={{ page: 1, paths }} />);
    expect(out).toContain('id="show-paginate-table"');
  });

  it("DependentFragment renders the dependent select target", async () => {
    const out = await render(<DependentFragment data={{ category: "fruit" }} icon={icon} />);
    expect(out).toContain('id="show-dependent-select"');
  });

  it("ToastFragment renders an OOB flash targeting the flash container", async () => {
    const out = await render(<ToastFragment data={{ type: "success" }} />);
    expect(out).toContain("hx-swap-oob");
    expect(out).toContain("flash-container");
  });
});

describe("show sections", () => {
  it("PreviewSection renders its demo section", async () => {
    const out = await render(<PreviewSection paths={paths} icon={icon} />);
    expect(out).toContain('id="demo-preview"');
    expect(out).toContain("Live Preview");
  });

  it("ValidateSection renders its demo section", async () => {
    const out = await render(<ValidateSection paths={paths} />);
    expect(out).toContain('id="demo-validate"');
    expect(out).toContain("Inline Validation");
  });

  it("SearchSection renders its demo section", async () => {
    const out = await render(<SearchSection paths={paths} />);
    expect(out).toContain('id="demo-search"');
    expect(out).toContain("Live Search");
  });

  it("PaginateSection renders its demo section", async () => {
    const out = await render(<PaginateSection paths={paths} />);
    expect(out).toContain('id="demo-paginate"');
    expect(out).toContain("Paginated Table");
  });

  it("DependentSection renders its demo section", async () => {
    const out = await render(<DependentSection paths={paths} icon={icon} />);
    expect(out).toContain('id="demo-dependent"');
    expect(out).toContain("Dependent Select");
  });

  it("ToastSection renders its demo section", async () => {
    const out = await render(<ToastSection paths={paths} />);
    expect(out).toContain('id="demo-toast"');
    expect(out).toContain("Flash Toast (OOB)");
  });
});
