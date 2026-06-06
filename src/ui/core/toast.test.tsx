/** @jsxImportSource @y-core/forge */
import { describe, expect, it } from "bun:test";
import { renderToString } from "../../jsx/render-to-string";
import { Toast } from "./toast";

async function render(element: unknown): Promise<string> {
  return String(await renderToString(element));
}

describe("Toast", () => {
  it("renders with role=status and data-slot=toast", async () => {
    const out = await render(<Toast>Message</Toast>);
    expect(out).toContain('role="status"');
    expect(out).toContain('data-slot="toast"');
    expect(out).toContain("Message");
  });

  it("defaults to the default variant", async () => {
    const out = await render(<Toast>Hello</Toast>);
    expect(out).toContain('data-variant="default"');
    expect(out).toContain("bg-background");
    expect(out).toContain("text-foreground");
  });

  it("renders success variant classes", async () => {
    const out = await render(<Toast variant='success'>Done</Toast>);
    expect(out).toContain('data-variant="success"');
    expect(out).toContain("bg-emerald-50");
    expect(out).toContain("text-emerald-900");
  });

  it("renders info variant classes", async () => {
    const out = await render(<Toast variant='info'>Info</Toast>);
    expect(out).toContain('data-variant="info"');
    expect(out).toContain("bg-blue-50");
    expect(out).toContain("text-blue-900");
  });

  it("renders warning variant classes", async () => {
    const out = await render(<Toast variant='warning'>Alert</Toast>);
    expect(out).toContain('data-variant="warning"');
    expect(out).toContain("bg-yellow-50");
    expect(out).toContain("text-yellow-900");
  });

  it("renders destructive variant classes", async () => {
    const out = await render(<Toast variant='destructive'>Error</Toast>);
    expect(out).toContain('data-variant="destructive"');
    expect(out).toContain("bg-red-50");
    expect(out).toContain("text-red-900");
  });

  it("has aria-atomic=true", async () => {
    const out = await render(<Toast>Message</Toast>);
    expect(out).toContain('aria-atomic="true"');
  });

  it("renders dismiss button when dismissible=true", async () => {
    const out = await render(<Toast dismissible>Message</Toast>);
    expect(out).toContain('data-slot="toast-close"');
    expect(out).toContain('aria-label="Dismiss notification"');
  });

  it("does not render dismiss button by default", async () => {
    const out = await render(<Toast>Message</Toast>);
    expect(out).not.toContain('data-slot="toast-close"');
  });

  it("adds pr-10 padding when dismissible to make room for close button", async () => {
    const out = await render(<Toast dismissible>Message</Toast>);
    expect(out).toContain("pr-10");
  });

  it("merges a custom class", async () => {
    const out = await render(<Toast class='my-toast'>Hello</Toast>);
    expect(out).toContain("my-toast");
    expect(out).toContain("rounded-xl");
  });
});

describe("Toast.Container", () => {
  it("renders as <section> with aria-live=polite", async () => {
    const out = await render(<Toast.Container />);
    expect(out).toContain("<section");
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('aria-atomic="false"');
    expect(out).toContain('aria-label="Notifications"');
    expect(out).toContain('data-slot="toast-container"');
  });

  it("defaults to bottom-right position", async () => {
    const out = await render(<Toast.Container />);
    expect(out).toContain('data-position="bottom-right"');
    expect(out).toContain("bottom-4");
    expect(out).toContain("right-4");
  });

  it("renders top-left position classes", async () => {
    const out = await render(<Toast.Container position='top-left' />);
    expect(out).toContain('data-position="top-left"');
    expect(out).toContain("top-4");
    expect(out).toContain("left-4");
  });

  it("renders top-center position with translate", async () => {
    const out = await render(<Toast.Container position='top-center' />);
    expect(out).toContain("top-4");
    expect(out).toContain("-translate-x-1/2");
  });

  it("renders top-right position classes", async () => {
    const out = await render(<Toast.Container position='top-right' />);
    expect(out).toContain("top-4");
    expect(out).toContain("right-4");
  });

  it("renders fixed positioning and z-index", async () => {
    const out = await render(<Toast.Container />);
    expect(out).toContain("fixed");
    expect(out).toContain("z-50");
  });

  it("renders children", async () => {
    const out = await render(
      <Toast.Container>
        <Toast>Hello</Toast>
      </Toast.Container>,
    );
    expect(out).toContain('data-slot="toast"');
    expect(out).toContain("Hello");
  });
});

describe("Toast.Title and Toast.Description", () => {
  it("renders Toast.Title with data-slot=toast-title", async () => {
    const out = await render(<Toast.Title>Success</Toast.Title>);
    expect(out).toContain('data-slot="toast-title"');
    expect(out).toContain("Success");
    expect(out).toContain("font-semibold");
  });

  it("renders Toast.Description with data-slot=toast-description", async () => {
    const out = await render(<Toast.Description>Your changes were saved.</Toast.Description>);
    expect(out).toContain('data-slot="toast-description"');
    expect(out).toContain("Your changes were saved.");
    expect(out).toContain("opacity-90");
  });
});
