/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";

import { render } from "../../../testing/render";
import { elementOf } from "../test-support";
import { AuthTimestamp } from "./timestamp";

const NEW_YEAR = 1735689600000;

describe("AuthTimestamp", () => {
  it("carries the full instant in the attribute and the date alone in the text", async () => {
    expect(elementOf(await render(<AuthTimestamp at={NEW_YEAR} />), "time", "datetime")).toBe(
      '<time datetime="2025-01-01T00:00:00.000Z" class="tabular-nums">2025-01-01</time>',
    );
  });

  it("reads the instant as UTC, so a stored millisecond renders the same wherever it is read", async () => {
    const html = await render(<AuthTimestamp at={NEW_YEAR - 1} />);
    expect(elementOf(html, "time", "datetime")).toBe('<time datetime="2024-12-31T23:59:59.999Z" class="tabular-nums">2024-12-31</time>');
  });

  it("takes a ref so a calling view can name what the date is of", async () => {
    const html = await render(<AuthTimestamp at={NEW_YEAR} data-ref='credential-created' />);
    expect(elementOf(html, "time", 'data-ref="credential-created"')).toBe(
      '<time data-ref="credential-created" datetime="2025-01-01T00:00:00.000Z" class="tabular-nums">2025-01-01</time>',
    );
  });
});
