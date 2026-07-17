import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Avatar } from "./avatar";

describe("Avatar", () => {
  it("renders a <span> with data-slot=avatar", async () => {
    expect(await render(<Avatar />)).toBe(
      '<span data-slot="avatar" data-size="md" class="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted size-10 text-sm"></span>',
    );
  });

  it("defaults to md size", async () => {
    expect(await render(<Avatar />)).toBe(
      '<span data-slot="avatar" data-size="md" class="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted size-10 text-sm"></span>',
    );
  });

  it("renders sm size classes", async () => {
    expect(await render(<Avatar size='sm' />)).toBe(
      '<span data-slot="avatar" data-size="sm" class="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted size-8 text-xs"></span>',
    );
  });

  it("renders lg size classes", async () => {
    expect(await render(<Avatar size='lg' />)).toBe(
      '<span data-slot="avatar" data-size="lg" class="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted size-14 text-base"></span>',
    );
  });

  it("renders rounded-full and overflow-hidden classes", async () => {
    expect(await render(<Avatar />)).toBe(
      '<span data-slot="avatar" data-size="md" class="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted size-10 text-sm"></span>',
    );
  });

  it("merges a custom class", async () => {
    expect(await render(<Avatar class='ring-2 ring-primary' />)).toBe(
      '<span data-slot="avatar" data-size="md" class="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted size-10 text-sm ring-2 ring-primary"></span>',
    );
  });

  it("renders children", async () => {
    expect(
      await render(
        <Avatar>
          <Avatar.Fallback>AB</Avatar.Fallback>
        </Avatar>,
      ),
    ).toBe(
      '<span data-slot="avatar" data-size="md" class="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted size-10 text-sm"><span data-slot="avatar-fallback" class="flex size-full items-center justify-center font-medium text-muted-foreground">AB</span></span>',
    );
  });
});

describe("Avatar.Image", () => {
  it("renders an <img> with data-slot=avatar-image", async () => {
    expect(await render(<Avatar.Image src='/user.jpg' alt='Alice' />)).toBe(
      '<img data-slot="avatar-image" class="aspect-square size-full object-cover" alt="Alice" src="/user.jpg">',
    );
  });

  it("passes alt text through", async () => {
    expect(await render(<Avatar.Image src='/user.jpg' alt='Alice Smith' />)).toBe(
      '<img data-slot="avatar-image" class="aspect-square size-full object-cover" alt="Alice Smith" src="/user.jpg">',
    );
  });

  it("passes src through", async () => {
    expect(await render(<Avatar.Image src='/avatars/alice.jpg' alt='Alice' />)).toBe(
      '<img data-slot="avatar-image" class="aspect-square size-full object-cover" alt="Alice" src="/avatars/alice.jpg">',
    );
  });

  it("renders size-full and object-cover classes", async () => {
    expect(await render(<Avatar.Image src='/u.jpg' alt='User' />)).toBe(
      '<img data-slot="avatar-image" class="aspect-square size-full object-cover" alt="User" src="/u.jpg">',
    );
  });
});

describe("Avatar.Fallback", () => {
  it("renders a <span> with data-slot=avatar-fallback", async () => {
    expect(await render(<Avatar.Fallback>AB</Avatar.Fallback>)).toBe(
      '<span data-slot="avatar-fallback" class="flex size-full items-center justify-center font-medium text-muted-foreground">AB</span>',
    );
  });

  it("renders centered layout classes", async () => {
    expect(await render(<Avatar.Fallback>JD</Avatar.Fallback>)).toBe(
      '<span data-slot="avatar-fallback" class="flex size-full items-center justify-center font-medium text-muted-foreground">JD</span>',
    );
  });

  it("merges a custom class", async () => {
    expect(await render(<Avatar.Fallback class='text-lg'>XL</Avatar.Fallback>)).toBe(
      '<span data-slot="avatar-fallback" class="flex size-full items-center justify-center font-medium text-muted-foreground text-lg">XL</span>',
    );
  });
});
