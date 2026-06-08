import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Avatar } from "./avatar";

describe("Avatar", () => {
  it("renders a <span> with data-slot=avatar", async () => {
    const out = await render(<Avatar />);
    expect(out).toContain("<span");
    expect(out).toContain('data-slot="avatar"');
  });

  it("defaults to md size", async () => {
    const out = await render(<Avatar />);
    expect(out).toContain('data-size="md"');
    expect(out).toContain("size-10");
  });

  it("renders sm size classes", async () => {
    const out = await render(<Avatar size='sm' />);
    expect(out).toContain('data-size="sm"');
    expect(out).toContain("size-8");
  });

  it("renders lg size classes", async () => {
    const out = await render(<Avatar size='lg' />);
    expect(out).toContain('data-size="lg"');
    expect(out).toContain("size-14");
  });

  it("renders rounded-full and overflow-hidden classes", async () => {
    const out = await render(<Avatar />);
    expect(out).toContain("rounded-full");
    expect(out).toContain("overflow-hidden");
  });

  it("merges a custom class", async () => {
    const out = await render(<Avatar class='ring-2 ring-primary' />);
    expect(out).toContain("ring-2");
    expect(out).toContain("ring-primary");
  });

  it("renders children", async () => {
    const out = await render(
      <Avatar>
        <Avatar.Fallback>AB</Avatar.Fallback>
      </Avatar>,
    );
    expect(out).toContain('data-slot="avatar-fallback"');
    expect(out).toContain("AB");
  });
});

describe("Avatar.Image", () => {
  it("renders an <img> with data-slot=avatar-image", async () => {
    const out = await render(<Avatar.Image src='/user.jpg' alt='Alice' />);
    expect(out).toContain("<img");
    expect(out).toContain('data-slot="avatar-image"');
  });

  it("passes alt text through", async () => {
    const out = await render(<Avatar.Image src='/user.jpg' alt='Alice Smith' />);
    expect(out).toContain('alt="Alice Smith"');
  });

  it("passes src through", async () => {
    const out = await render(<Avatar.Image src='/avatars/alice.jpg' alt='Alice' />);
    expect(out).toContain('src="/avatars/alice.jpg"');
  });

  it("renders size-full and object-cover classes", async () => {
    const out = await render(<Avatar.Image src='/u.jpg' alt='User' />);
    expect(out).toContain("size-full");
    expect(out).toContain("object-cover");
  });
});

describe("Avatar.Fallback", () => {
  it("renders a <span> with data-slot=avatar-fallback", async () => {
    const out = await render(<Avatar.Fallback>AB</Avatar.Fallback>);
    expect(out).toContain("<span");
    expect(out).toContain('data-slot="avatar-fallback"');
    expect(out).toContain("AB");
  });

  it("renders centered layout classes", async () => {
    const out = await render(<Avatar.Fallback>JD</Avatar.Fallback>);
    expect(out).toContain("items-center");
    expect(out).toContain("justify-center");
    expect(out).toContain("text-muted-foreground");
  });

  it("merges a custom class", async () => {
    const out = await render(<Avatar.Fallback class='text-lg'>XL</Avatar.Fallback>);
    expect(out).toContain("text-lg");
  });
});
