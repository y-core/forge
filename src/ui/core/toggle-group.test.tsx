import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { ToggleGroup } from "./toggle-group";

describe("ToggleGroup", () => {
  it("root emits data-slot=toggle-group on a fieldset", async () => {
    expect(await render(<ToggleGroup aria-label='Projection' data-ref='projection-group' />)).toBe(
      '<fieldset data-slot="toggle-group" data-orientation="horizontal" class="flex justify-center min-w-0 border-0 m-0 p-0" aria-label="Projection" data-ref="projection-group"></fieldset>',
    );
  });

  it("root includes base layout classes", async () => {
    expect(await render(<ToggleGroup />)).toBe(
      '<fieldset data-slot="toggle-group" data-orientation="horizontal" class="flex justify-center min-w-0 border-0 m-0 p-0"></fieldset>',
    );
  });

  it("root merges a custom class with the base classes", async () => {
    expect(await render(<ToggleGroup class='extra-root' />)).toBe(
      '<fieldset data-slot="toggle-group" data-orientation="horizontal" class="flex justify-center min-w-0 border-0 m-0 p-0 extra-root"></fieldset>',
    );
  });

  it("item emits data-slot=toggle-group-item, type=button, and aria-pressed=false by default", async () => {
    expect(await render(<ToggleGroup.Item>Label</ToggleGroup.Item>)).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm bg-transparent border border-input border-l-0 cursor-pointer rounded-none first:border-l first:rounded-l-md last:rounded-r-md hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary">Label</button>',
    );
  });

  it("item takes core/Button's ghost box, focus ring included, at the size the caller names", async () => {
    expect(await render(<ToggleGroup.Item size='lg'>X</ToggleGroup.Item>)).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-12 px-6 text-base bg-transparent border border-input border-l-0 cursor-pointer rounded-none first:border-l first:rounded-l-md last:rounded-r-md hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary">X</button>',
    );
  });

  it("item at size=icon-sm renders the 32px square box", async () => {
    expect(await render(<ToggleGroup.Item size='icon-sm'>X</ToggleGroup.Item>)).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent size-8 p-0 bg-transparent border border-input border-l-0 cursor-pointer rounded-none first:border-l first:rounded-l-md last:rounded-r-md hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary">X</button>',
    );
  });

  it("item with pressed=true emits data-pressed and aria-pressed=true, the paint keyed on the attribute", async () => {
    expect(await render(<ToggleGroup.Item pressed>Active</ToggleGroup.Item>)).toBe(
      '<button type="button" data-slot="toggle-group-item" data-pressed="" aria-pressed="true" class="inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm bg-transparent border border-input border-l-0 cursor-pointer rounded-none first:border-l first:rounded-l-md last:rounded-r-md hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary">Active</button>',
    );
  });

  it("item without pressed emits aria-pressed=false and no data-pressed", async () => {
    expect(await render(<ToggleGroup.Item>Inactive</ToggleGroup.Item>)).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm bg-transparent border border-input border-l-0 cursor-pointer rounded-none first:border-l first:rounded-l-md last:rounded-r-md hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary">Inactive</button>',
    );
  });

  it("pressed and unpressed items carry an identical class list, differing only in the state attributes", async () => {
    const pressed = await render(<ToggleGroup.Item pressed>X</ToggleGroup.Item>);
    const unpressed = await render(<ToggleGroup.Item>X</ToggleGroup.Item>);

    expect(pressed.replace(' data-pressed=""', "").replace('aria-pressed="true"', 'aria-pressed="false"')).toBe(unpressed);
  });

  it("item spreads data-on-click, data-mode, data-ref, and title", async () => {
    expect(
      await render(
        <ToggleGroup.Item data-on-click='cameraMode' data-mode='perspective' data-ref='cam-perspective' title='Perspective'>
          P
        </ToggleGroup.Item>,
      ),
    ).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm bg-transparent border border-input border-l-0 cursor-pointer rounded-none first:border-l first:rounded-l-md last:rounded-r-md hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary" data-on-click="cameraMode" data-mode="perspective" data-ref="cam-perspective" title="Perspective">P</button>',
    );
  });

  it("item renders text children", async () => {
    expect(await render(<ToggleGroup.Item>perspective</ToggleGroup.Item>)).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm bg-transparent border border-input border-l-0 cursor-pointer rounded-none first:border-l first:rounded-l-md last:rounded-r-md hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary">perspective</button>',
    );
  });

  it("item merges a custom class with the base classes", async () => {
    expect(await render(<ToggleGroup.Item class='extra-cls'>X</ToggleGroup.Item>)).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm bg-transparent border border-input border-l-0 cursor-pointer rounded-none first:border-l first:rounded-l-md last:rounded-r-md hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary extra-cls">X</button>',
    );
  });

  it("item renders label children inside a full group", async () => {
    expect(
      await render(
        <ToggleGroup aria-label='Views'>
          <ToggleGroup.Item pressed data-ref='perspective-btn'>
            Perspective
          </ToggleGroup.Item>
          <ToggleGroup.Item data-ref='parallel-btn'>Parallel</ToggleGroup.Item>
        </ToggleGroup>,
      ),
    ).toBe(
      '<fieldset data-slot="toggle-group" data-orientation="horizontal" class="flex justify-center min-w-0 border-0 m-0 p-0" aria-label="Views"><button type="button" data-slot="toggle-group-item" data-pressed="" aria-pressed="true" class="inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm bg-transparent border border-input border-l-0 cursor-pointer rounded-none first:border-l first:rounded-l-md last:rounded-r-md hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary" data-ref="perspective-btn">Perspective</button><button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm bg-transparent border border-input border-l-0 cursor-pointer rounded-none first:border-l first:rounded-l-md last:rounded-r-md hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary" data-ref="parallel-btn">Parallel</button></fieldset>',
    );
  });

  it("defaults to horizontal orientation with no data-orientation attribute override", async () => {
    expect(await render(<ToggleGroup />)).toBe(
      '<fieldset data-slot="toggle-group" data-orientation="horizontal" class="flex justify-center min-w-0 border-0 m-0 p-0"></fieldset>',
    );
  });

  it("gives the group neither a role nor an aria-orientation, on either axis", async () => {
    expect(await render(<ToggleGroup orientation='vertical' aria-label='Projection' />)).toBe(
      '<fieldset data-slot="toggle-group" data-orientation="vertical" class="flex justify-center min-w-0 border-0 m-0 p-0 flex-col" aria-label="Projection"></fieldset>',
    );
    expect(await render(<ToggleGroup orientation='horizontal' aria-label='Projection' />)).toBe(
      '<fieldset data-slot="toggle-group" data-orientation="horizontal" class="flex justify-center min-w-0 border-0 m-0 p-0" aria-label="Projection"></fieldset>',
    );
  });

  it("vertical orientation stamps data-orientation and adds flex-col to the group", async () => {
    expect(await render(<ToggleGroup orientation='vertical' />)).toBe(
      '<fieldset data-slot="toggle-group" data-orientation="vertical" class="flex justify-center min-w-0 border-0 m-0 p-0 flex-col"></fieldset>',
    );
  });

  it("item includes the arbitrary vertical ancestor variant class for border override", async () => {
    expect(await render(<ToggleGroup.Item>X</ToggleGroup.Item>)).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm bg-transparent border border-input border-l-0 cursor-pointer rounded-none first:border-l first:rounded-l-md last:rounded-r-md hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary">X</button>',
    );
  });

  it("item carries vertical rounded-t-md and rounded-b-md but not rounded-l-none or rounded-r-none overrides", async () => {
    expect(await render(<ToggleGroup.Item>X</ToggleGroup.Item>)).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm bg-transparent border border-input border-l-0 cursor-pointer rounded-none first:border-l first:rounded-l-md last:rounded-r-md hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary">X</button>',
    );
  });
});
