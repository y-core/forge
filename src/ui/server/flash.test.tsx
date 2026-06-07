/** @jsxImportSource @y-core/forge */
import { describe, expect, it } from "bun:test";
import { renderToString } from "../../jsx/render-to-string";
import { Flash, FlashContainer, FlashOob } from "./flash";

async function render(element: unknown): Promise<string> {
  return String(await renderToString(element));
}

describe("Flash", () => {
  it("renders nothing for empty messages array", async () => {
    const out = await render(<Flash messages={[]} />);
    expect(out).not.toContain('data-slot="toast"');
  });

  it("renders nothing when messages is undefined", async () => {
    const out = await render(<Flash />);
    expect(out).not.toContain('data-slot="toast"');
  });

  it("renders success toast with success variant", async () => {
    const out = await render(<Flash messages={[{ type: "success", text: "Saved!" }]} />);
    expect(out).toContain('data-variant="success"');
    expect(out).toContain("Saved!");
    expect(out).toContain('data-slot="toast"');
  });

  it("maps error type to destructive variant", async () => {
    const out = await render(<Flash messages={[{ type: "error", text: "Failed" }]} />);
    expect(out).toContain('data-variant="destructive"');
    expect(out).toContain("Failed");
  });

  it("maps info type to info variant", async () => {
    const out = await render(<Flash messages={[{ type: "info", text: "FYI" }]} />);
    expect(out).toContain('data-variant="info"');
    expect(out).toContain("FYI");
  });

  it("maps warning type to warning variant", async () => {
    const out = await render(<Flash messages={[{ type: "warning", text: "Careful" }]} />);
    expect(out).toContain('data-variant="warning"');
    expect(out).toContain("Careful");
  });

  it("renders multiple messages", async () => {
    const out = await render(
      <Flash
        messages={[
          { type: "success", text: "All good" },
          { type: "error", text: "Something failed" },
        ]}
      />,
    );
    expect(out).toContain("All good");
    expect(out).toContain("Something failed");
    expect(out).toContain('data-variant="success"');
    expect(out).toContain('data-variant="destructive"');
  });

  it("renders toasts as dismissible", async () => {
    const out = await render(<Flash messages={[{ type: "info", text: "Hello" }]} />);
    expect(out).toContain('data-slot="toast-close"');
  });

  it("renders title when provided", async () => {
    const out = await render(<Flash messages={[{ type: "success", text: "Body text", title: "Great news" }]} />);
    expect(out).toContain('data-slot="toast-title"');
    expect(out).toContain("Great news");
    expect(out).toContain("Body text");
  });

  it("does not render title slot when title is omitted", async () => {
    const out = await render(<Flash messages={[{ type: "info", text: "No title here" }]} />);
    expect(out).not.toContain('data-slot="toast-title"');
    expect(out).toContain("No title here");
  });
});

describe("FlashContainer", () => {
  it("always renders toast-container with id and aria-live even when no messages", async () => {
    const out = await render(<FlashContainer />);
    expect(out).toContain('id="flash-container"');
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('data-slot="toast-container"');
  });

  it("always renders wrapper even with empty messages array", async () => {
    const out = await render(<FlashContainer messages={[]} />);
    expect(out).toContain('id="flash-container"');
  });

  it("renders messages inside the container", async () => {
    const out = await render(<FlashContainer messages={[{ type: "info", text: "Hello" }]} />);
    expect(out).toContain('id="flash-container"');
    expect(out).toContain("Hello");
    expect(out).toContain('data-variant="info"');
  });

  it("reflects position prop as data-position attribute", async () => {
    const out = await render(<FlashContainer position='top-right' />);
    expect(out).toContain('data-position="top-right"');
  });
});

describe("FlashOob", () => {
  it("renders nothing for empty messages array", async () => {
    const out = await render(<FlashOob messages={[]} />);
    expect(out).not.toContain("hx-swap-oob");
    expect(out).not.toContain('data-slot="toast"');
  });

  it("renders nothing when messages is undefined", async () => {
    const out = await render(<FlashOob />);
    expect(out).not.toContain("hx-swap-oob");
  });

  it("renders oob swap attr targeting #flash-container on each wrapper div", async () => {
    const out = await render(<FlashOob messages={[{ type: "success", text: "Done" }]} />);
    expect(out).toContain('hx-swap-oob="beforeend:#flash-container"');
    expect(out).toContain("Done");
    expect(out).toContain('data-variant="success"');
  });

  it("renders one oob wrapper per message", async () => {
    const out = await render(
      <FlashOob
        messages={[
          { type: "success", text: "A" },
          { type: "error", text: "B" },
        ]}
      />,
    );
    expect((out.match(/hx-swap-oob="beforeend:#flash-container"/g) ?? []).length).toBe(2);
  });

  it("uses custom selector and strategy when provided", async () => {
    const out = await render(<FlashOob messages={[{ type: "info", text: "Custom" }]} selector='#notifications' strategy='afterend' />);
    expect(out).toContain('hx-swap-oob="afterend:#notifications"');
    expect(out).toContain("Custom");
  });
});
