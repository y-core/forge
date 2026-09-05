/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Stat } from "./stat";

describe("Stat", () => {
  it("renders the bordered surface", async () => {
    expect(await render(<Stat>1</Stat>)).toBe(
      '<div data-slot="stat" class="flex flex-col gap-1 rounded-box border-field border-border bg-card p-4 text-card-foreground">1</div>',
    );
  });

  it("lets a caller's padding evict the default", async () => {
    expect(await render(<Stat class='p-8' />)).toBe(
      '<div data-slot="stat" class="flex flex-col gap-1 rounded-box border-field border-border bg-card text-card-foreground p-8"></div>',
    );
  });

  it("renders every compound", async () => {
    expect(
      await render(
        <Stat>
          <Stat.Figure>i</Stat.Figure>
          <Stat.Label>Users</Stat.Label>
          <Stat.Value>1,204</Stat.Value>
          <Stat.Description>+12%</Stat.Description>
          <Stat.Actions>x</Stat.Actions>
        </Stat>,
      ),
    ).toBe(
      '<div data-slot="stat" class="flex flex-col gap-1 rounded-box border-field border-border bg-card p-4 text-card-foreground">' +
        '<span data-slot="stat-figure" class="text-muted-foreground">i</span>' +
        '<span data-slot="stat-label" class="text-sm text-muted-foreground">Users</span>' +
        '<span data-slot="stat-value" class="text-2xl font-semibold tracking-tight text-balance tabular-nums">1,204</span>' +
        '<span data-slot="stat-description" class="text-xs text-muted-foreground">+12%</span>' +
        '<div data-slot="stat-actions" class="mt-2 flex gap-2">x</div>' +
        "</div>",
    );
  });

  it("escapes a value the way every other component does", async () => {
    expect(await render(<Stat.Value>{`R&D's "n" <x>`}</Stat.Value>)).toBe(
      '<span data-slot="stat-value" class="text-2xl font-semibold tracking-tight text-balance tabular-nums">R&amp;D&#39;s &quot;n&quot; &lt;x&gt;</span>',
    );
  });
});
