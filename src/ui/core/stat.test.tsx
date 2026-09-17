import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { attrsOf, variantClasses } from "./core.fixture";
import { Stat } from "./stat";

const compounds = (html: string) => [...html.matchAll(/<([a-z]+) data-slot="(stat-[a-z]+)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2], m[3]]);

describe("Stat", () => {
  it("renders a value exactly, escaping it the way every other component does", async () => {
    expect(await render(<Stat.Value>{`R&D's "n" <x>`}</Stat.Value>)).toBe(
      '<span data-slot="stat-value" class="text-2xl font-semibold tracking-tight text-balance tabular-nums">R&amp;D&#39;s &quot;n&quot; &lt;x&gt;</span>',
    );
  });

  it("names the surface with a slot and nothing else, leaving every attribute to the caller", async () => {
    expect(attrsOf(await render(<Stat>1</Stat>))).toEqual({ "data-slot": "stat" });
  });

  it("lets a caller's padding evict the default rather than emit two", async () => {
    expect(variantClasses(await render(<Stat class='p-8' />), await render(<Stat />))).toEqual({ added: ["p-8"], dropped: ["p-4"] });
  });

  it("nests every compound inside the surface in the order it was given, each under its own slot", async () => {
    const html = await render(
      <Stat>
        <Stat.Figure>i</Stat.Figure>
        <Stat.Label>Users</Stat.Label>
        <Stat.Value>1,204</Stat.Value>
        <Stat.Description>+12%</Stat.Description>
        <Stat.Actions>x</Stat.Actions>
      </Stat>,
    );

    expect(compounds(html)).toEqual([
      ["span", "stat-figure", "i"],
      ["span", "stat-label", "Users"],
      ["span", "stat-value", "1,204"],
      ["span", "stat-description", "+12%"],
      ["div", "stat-actions", "x"],
    ]);
  });
});
