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
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center bg-transparent text-foreground border border-input border-l-0 cursor-pointer first:border-l first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md size-[34px] [&amp;_svg]:size-[18px] data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary">Label</button>',
    );
  });

  it("item with pressed=true emits data-pressed and aria-pressed=true, the paint keyed on the attribute", async () => {
    expect(await render(<ToggleGroup.Item pressed>Active</ToggleGroup.Item>)).toBe(
      '<button type="button" data-slot="toggle-group-item" data-pressed="" aria-pressed="true" class="inline-flex items-center justify-center bg-transparent text-foreground border border-input border-l-0 cursor-pointer first:border-l first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md size-[34px] [&amp;_svg]:size-[18px] data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary">Active</button>',
    );
  });

  it("item without pressed emits aria-pressed=false and no data-pressed", async () => {
    expect(await render(<ToggleGroup.Item>Inactive</ToggleGroup.Item>)).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center bg-transparent text-foreground border border-input border-l-0 cursor-pointer first:border-l first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md size-[34px] [&amp;_svg]:size-[18px] data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary">Inactive</button>',
    );
  });

  it("pressed and unpressed items carry an identical class list, differing only in the state attributes", async () => {
    // The paint has to follow `data-pressed`, because that is all the client controller ever flips —
    // a class chosen at render time would freeze the highlight on whichever item the server rendered.
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
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center bg-transparent text-foreground border border-input border-l-0 cursor-pointer first:border-l first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md size-[34px] [&amp;_svg]:size-[18px] data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary" data-on-click="cameraMode" data-mode="perspective" data-ref="cam-perspective" title="Perspective">P</button>',
    );
  });

  it("item renders text children", async () => {
    expect(await render(<ToggleGroup.Item>perspective</ToggleGroup.Item>)).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center bg-transparent text-foreground border border-input border-l-0 cursor-pointer first:border-l first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md size-[34px] [&amp;_svg]:size-[18px] data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary">perspective</button>',
    );
  });

  it("item merges a custom class with the base classes", async () => {
    expect(await render(<ToggleGroup.Item class='extra-cls'>X</ToggleGroup.Item>)).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center bg-transparent text-foreground border border-input border-l-0 cursor-pointer first:border-l first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md size-[34px] [&amp;_svg]:size-[18px] data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary extra-cls">X</button>',
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
      '<fieldset data-slot="toggle-group" data-orientation="horizontal" class="flex justify-center min-w-0 border-0 m-0 p-0" aria-label="Views"><button type="button" data-slot="toggle-group-item" data-pressed="" aria-pressed="true" class="inline-flex items-center justify-center bg-transparent text-foreground border border-input border-l-0 cursor-pointer first:border-l first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md size-[34px] [&amp;_svg]:size-[18px] data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary" data-ref="perspective-btn">Perspective</button><button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center bg-transparent text-foreground border border-input border-l-0 cursor-pointer first:border-l first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md size-[34px] [&amp;_svg]:size-[18px] data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary" data-ref="parallel-btn">Parallel</button></fieldset>',
    );
  });

  it("defaults to horizontal orientation with no data-orientation attribute override", async () => {
    expect(await render(<ToggleGroup />)).toBe(
      '<fieldset data-slot="toggle-group" data-orientation="horizontal" class="flex justify-center min-w-0 border-0 m-0 p-0"></fieldset>',
    );
  });

  it("vertical orientation stamps data-orientation and adds flex-col to the group", async () => {
    expect(await render(<ToggleGroup orientation='vertical' />)).toBe(
      '<fieldset data-slot="toggle-group" data-orientation="vertical" class="flex justify-center min-w-0 border-0 m-0 p-0 flex-col"></fieldset>',
    );
  });

  it("item includes the arbitrary vertical ancestor variant class for border override", async () => {
    expect(await render(<ToggleGroup.Item>X</ToggleGroup.Item>)).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center bg-transparent text-foreground border border-input border-l-0 cursor-pointer first:border-l first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md size-[34px] [&amp;_svg]:size-[18px] data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary">X</button>',
    );
  });

  it("item carries vertical rounded-t-md and rounded-b-md but not rounded-l-none or rounded-r-none overrides", async () => {
    expect(await render(<ToggleGroup.Item>X</ToggleGroup.Item>)).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center bg-transparent text-foreground border border-input border-l-0 cursor-pointer first:border-l first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md size-[34px] [&amp;_svg]:size-[18px] data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary">X</button>',
    );
  });
});
