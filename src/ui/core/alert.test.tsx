import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Alert } from "./alert";
import { attrOf, attrsOf, classesOf, tagOf, variantClasses } from "./core.fixture";

const callout = (props: Parameters<typeof Alert>[0] = {}) => render(<Alert {...props}>Message</Alert>);
const textNodes = (html: string) => html.split(/<[^>]+>/).filter(Boolean);

describe("Alert", () => {
  it("renders the whole callout exactly, forwarded attributes and children escaped", async () => {
    expect(await render(<Alert id='a1' data-note='a&b'>{`R&D's`}</Alert>)).toBe(
      '<div data-slot="alert" data-tone="neutral" data-appearance="soft" class="relative grid gap-1.5 rounded-box border-field py-3 ps-4' +
        " pe-4 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)]" +
        " [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)]" +
        " border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)]" +
        ' hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]" id="a1" data-note="a&amp;b">R&amp;D&#39;s</div>',
    );
  });

  it("stamps both axes as attributes, so a variant is readable without reading a class list", async () => {
    expect(attrsOf(await callout())).toEqual({ "data-slot": "alert", "data-tone": "neutral", "data-appearance": "soft" });
  });

  it("carries no role at any tone, because the flash region is the page's one live region", async () => {
    const tones = ["neutral", "primary", "destructive", "success", "warning", "info"] as const;
    const rendered = await Promise.all(tones.map((tone) => callout({ tone })));

    expect(rendered.map((html) => attrOf(html, "role"))).toEqual(tones.map(() => ""));
  });

  it("takes a caller's role, which is how a callout that must announce gets to", async () => {
    expect(attrsOf(await callout({ role: "status" }))).toEqual({
      "data-slot": "alert",
      "data-tone": "neutral",
      "data-appearance": "soft",
      role: "status",
    });
  });

  it("swaps the whole tone palette rather than overlaying a second one", async () => {
    const { added, dropped } = variantClasses(await callout({ tone: "destructive" }), await callout());

    expect(added.every((token) => token.startsWith("[--tone"))).toBe(true);
    expect(dropped.every((token) => token.startsWith("[--tone"))).toBe(true);
    expect(added.length).toBe(dropped.length);
  });

  it("gives the solid appearance its own fill and evicts the soft one it conflicts with", async () => {
    expect(variantClasses(await callout({ tone: "success", appearance: "solid" }), await callout({ tone: "success" }))).toEqual({
      added: [
        "border-transparent",
        "bg-(--tone)",
        "text-(--tone-fg)",
        "[--focus-ring:var(--tone-fg)]",
        "hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]",
      ],
      dropped: [
        "border-(--tone-soft-border)",
        "bg-(--tone-soft)",
        "text-(--tone-soft-fg)",
        "[--focus-ring:var(--color-ring)]",
        "hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]",
      ],
    });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await callout({ class: "my-custom" })).at(-1)).toBe("my-custom");
  });

  it("nests the title and the description as sibling slots, in the order they were given", async () => {
    const html = await render(
      <Alert>
        <Alert.Title>Status</Alert.Title>
        <Alert.Description>Everything is in sync.</Alert.Description>
      </Alert>,
    );

    expect(textNodes(html)).toEqual(["Status", "Everything is in sync."]);
  });

  it("forwards an attribute onto the title and the description rather than onto their parent", async () => {
    const html = await render(
      <Alert>
        <Alert.Title id='t1'>Status</Alert.Title>
        <Alert.Description role='note'>Detail</Alert.Description>
      </Alert>,
    );

    expect(attrsOf(html, 'data-slot="alert-title"')).toEqual({ "data-slot": "alert-title", id: "t1" });
    expect(attrsOf(html, 'data-slot="alert-description"')).toEqual({ "data-slot": "alert-description", role: "note" });
  });

  it("stamps the scope its dismiss controller registers, and widens the end padding to clear the button", async () => {
    const html = await callout({ dismissible: true });

    expect(attrsOf(html)).toEqual({ "data-slot": "alert", "data-tone": "neutral", "data-appearance": "soft", "data-scope": "alert" });
    expect(attrsOf(html, 'data-slot="alert-dismiss"')).toEqual({
      type: "button",
      "data-slot": "alert-dismiss",
      "aria-label": "Dismiss",
      "data-on-click": "dismiss",
    });
    expect(variantClasses(html, await callout())).toEqual({ added: ["pe-8"], dropped: ["pe-4"] });
    expect(textNodes(html)).toEqual(["Message", "×"]);
  });

  it("renders neither the dismiss button nor the scope unless it was asked for one", async () => {
    const html = await callout();

    expect(tagOf(html, 'data-slot="alert-dismiss"')).toBe("");
    expect(attrOf(html, "data-scope")).toBe("");
  });
});
