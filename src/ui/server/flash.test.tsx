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
    expect(out).not.toContain('data-slot="alert"');
  });

  it("renders nothing when messages is undefined", async () => {
    const out = await render(<Flash />);
    expect(out).not.toContain('data-slot="alert"');
  });

  it("renders success alert with success variant", async () => {
    const out = await render(<Flash messages={[{ type: "success", text: "Saved!" }]} />);
    expect(out).toContain('data-variant="success"');
    expect(out).toContain("Saved!");
    expect(out).toContain('data-slot="alert"');
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

  it("renders alerts as dismissible", async () => {
    const out = await render(<Flash messages={[{ type: "info", text: "Hello" }]} />);
    expect(out).toContain('data-slot="alert-dismiss"');
  });
});

describe("FlashContainer", () => {
  it("always renders div#flash with aria-live even when no messages", async () => {
    const out = await render(<FlashContainer />);
    expect(out).toContain('id="flash"');
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('class="grid gap-2"');
  });

  it("always renders wrapper even with empty messages array", async () => {
    const out = await render(<FlashContainer messages={[]} />);
    expect(out).toContain('id="flash"');
  });

  it("renders messages inside the container", async () => {
    const out = await render(<FlashContainer messages={[{ type: "info", text: "Hello" }]} />);
    expect(out).toContain('id="flash"');
    expect(out).toContain("Hello");
    expect(out).toContain('data-variant="info"');
  });
});

describe("FlashOob", () => {
  it("renders nothing for empty messages array", async () => {
    const out = await render(<FlashOob messages={[]} />);
    expect(out).not.toContain("hx-swap-oob");
    expect(out).not.toContain('data-slot="alert"');
  });

  it("renders nothing when messages is undefined", async () => {
    const out = await render(<FlashOob />);
    expect(out).not.toContain("hx-swap-oob");
  });

  it("renders oob swap attr targeting #flash on each wrapper div", async () => {
    const out = await render(<FlashOob messages={[{ type: "success", text: "Done" }]} />);
    expect(out).toContain('hx-swap-oob="beforeend:#flash"');
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
    expect((out.match(/hx-swap-oob="beforeend:#flash"/g) ?? []).length).toBe(2);
  });
});
