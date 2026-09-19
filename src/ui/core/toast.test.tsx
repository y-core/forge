import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Toast } from "./toast";

const textOf = (html: string) => html.replaceAll(/<[^>]*>/g, "");
const slotsOf = (html: string) => [...html.matchAll(/data-slot="([^"]+)"/g)].map((match) => match[1]);

describe("Toast", () => {
  it("renders the whole notification exactly, with forwarded values escaped", async () => {
    expect(
      await render(
        <Toast id='t1' data-testid='toast' data-note='a&b'>
          Hello
        </Toast>,
      ),
    ).toBe(
      '<div data-slot="toast" data-tone="neutral" data-appearance="soft" class="relative flex w-full items-start gap-3 rounded-box border-field' +
        " py-4 ps-4 pe-4 shadow-lg [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)]" +
        " [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)]" +
        " border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)]" +
        ' hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]" id="t1" data-testid="toast" data-note="a&amp;b">' +
        '<div data-slot="toast-body" class="flex-1 space-y-1">Hello</div></div>',
    );
  });

  it("claims no role and no live region of its own, since the container announces the whole stack", async () => {
    const html = await render(<Toast>Message</Toast>);

    expect(attrsOf(html)).toEqual({ "data-slot": "toast", "data-tone": "neutral", "data-appearance": "soft" });
    expect(slotsOf(html)).toEqual(["toast", "toast-body"]);
  });

  it("stamps the tone it was given and swaps the whole palette rather than overlaying a second one", async () => {
    const tones = ["success", "info", "warning", "destructive"] as const;
    const neutral = await render(<Toast>Message</Toast>);
    const rendered = await Promise.all(tones.map((tone) => render(<Toast tone={tone}>Message</Toast>)));

    expect(
      rendered.map((html) => {
        const { added, dropped } = variantClasses(html, neutral);
        return {
          tone: attrOf(html, "data-tone"),
          palette: added[0],
          beyondPalette: [...added, ...dropped].filter((t) => !t.startsWith("[--tone")),
        };
      }),
    ).toEqual([
      { tone: "success", palette: "[--tone:var(--color-success)]", beyondPalette: [] },
      { tone: "info", palette: "[--tone:var(--color-info)]", beyondPalette: [] },
      { tone: "warning", palette: "[--tone:var(--color-warning)]", beyondPalette: [] },
      { tone: "destructive", palette: "[--tone:var(--color-destructive)]", beyondPalette: [] },
    ]);
  });

  it("gives a dismissible toast a close button, the toast scope, and the end padding that button needs", async () => {
    const html = await render(<Toast dismissible>Message</Toast>);

    expect(attrsOf(html)).toEqual({
      "data-slot": "toast",
      "data-tone": "neutral",
      "data-appearance": "soft",
      "data-scope": "toast",
      "data-island-state": "{}",
    });
    expect(variantClasses(html, await render(<Toast>Message</Toast>))).toEqual({ added: ["pe-10"], dropped: ["pe-4"] });
    expect(attrsOf(html, 'data-slot="toast-close"')).toEqual({
      type: "button",
      "data-slot": "toast-close",
      "aria-label": "Dismiss notification",
      "data-on-click": "dismiss",
    });
  });

  it("hands the controller a duration in island state once there is a timer to run", async () => {
    const html = await render(<Toast duration={3000}>Message</Toast>);

    expect(attrOf(html, "data-scope")).toBe("toast");
    expect(attrOf(html, "data-island-state")).toBe("{&quot;duration&quot;:3000}");
  });

  it("stays inert with no scope when a duration of 0 leaves nothing for a controller to do", async () => {
    expect(attrsOf(await render(<Toast duration={0}>Message</Toast>))).toEqual({
      "data-slot": "toast",
      "data-tone": "neutral",
      "data-appearance": "soft",
    });
  });

  it("keeps a duration of 0 in island state, distinguishable from a duration never passed", async () => {
    const zero = await render(
      <Toast dismissible duration={0}>
        Message
      </Toast>,
    );

    expect(attrOf(zero, "data-island-state")).toBe("{&quot;duration&quot;:0}");
    expect(attrOf(await render(<Toast dismissible>Message</Toast>), "data-island-state")).toBe("{}");
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Toast class='my-toast'>Hello</Toast>)).at(-1)).toBe("my-toast");
  });
});

describe("Toast.Container", () => {
  it("is the one polite live region the stack is announced through, defaulting to the bottom right", async () => {
    const html = await render(<Toast.Container />);

    expect(attrsOf(html)).toEqual({
      "data-slot": "toast-container",
      "data-position": "bottom-right",
      "aria-label": "Notifications",
      "aria-live": "polite",
      "aria-atomic": "false",
    });
    expect(classesOf(html).filter((token) => token === "fixed" || token === "z-50")).toEqual(["fixed", "z-50"]);
  });

  it("moves the stack to the corner it was asked for and abandons the one it left", async () => {
    const positions = ["top-left", "top-center", "top-right"] as const;
    const bottomRight = await render(<Toast.Container />);
    const rendered = await Promise.all(positions.map((position) => render(<Toast.Container position={position} />)));

    expect(rendered.map((html) => attrOf(html, "data-position"))).toEqual([...positions]);
    expect(rendered.map((html) => variantClasses(html, bottomRight))).toEqual([
      { added: ["top-4", "left-4", "items-start"], dropped: ["bottom-4", "right-4", "items-end"] },
      { added: ["top-4", "left-1/2", "-translate-x-1/2", "items-center"], dropped: ["bottom-4", "right-4", "items-end"] },
      { added: ["top-4"], dropped: ["bottom-4"] },
    ]);
  });

  it("nests the toasts it was given inside the live region, where an insertion can be announced", async () => {
    expect(
      slotsOf(
        await render(
          <Toast.Container>
            <Toast>Hello</Toast>
          </Toast.Container>,
        ),
      ),
    ).toEqual(["toast-container", "toast", "toast-body"]);
  });

  it("forwards an id and a data attribute through the spread", async () => {
    expect(attrsOf(await render(<Toast.Container id='toasts' data-testid='container' />))).toEqual({
      "data-slot": "toast-container",
      "data-position": "bottom-right",
      "aria-label": "Notifications",
      "aria-live": "polite",
      "aria-atomic": "false",
      id: "toasts",
      "data-testid": "container",
    });
  });
});

describe("Toast.Title and Toast.Description", () => {
  it("names the title and the description apart, so a stylesheet can weight one over the other", async () => {
    const title = await render(<Toast.Title>Success</Toast.Title>);
    const description = await render(<Toast.Description>Your changes were saved.</Toast.Description>);

    expect([attrsOf(title), attrsOf(description)]).toEqual([{ "data-slot": "toast-title" }, { "data-slot": "toast-description" }]);
    expect([textOf(title), textOf(description)]).toEqual(["Success", "Your changes were saved."]);
  });

  it("forwards an id onto the title and an escaped value onto the description", async () => {
    expect(attrsOf(await render(<Toast.Title id='tt'>Saved</Toast.Title>))).toEqual({ "data-slot": "toast-title", id: "tt" });
    expect(attrsOf(await render(<Toast.Description data-note='a&b'>Detail</Toast.Description>))).toEqual({
      "data-slot": "toast-description",
      "data-note": "a&amp;b",
    });
  });
});
