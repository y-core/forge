/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Dialog } from "./dialog";

describe("Dialog", () => {
  it("renders a <dialog> with the given id and data-slot=dialog", async () => {
    expect(await render(<Dialog id='confirm'>Body</Dialog>)).toBe(
      '<dialog id="confirm" data-slot="dialog" class="rounded-xl border border-border bg-popover p-0 text-popover-foreground shadow-lg">Body</dialog>',
    );
  });

  it("merges a custom class", async () => {
    expect(
      await render(
        <Dialog id='confirm' class='w-96'>
          Body
        </Dialog>,
      ),
    ).toBe(
      '<dialog id="confirm" data-slot="dialog" class="rounded-xl border border-border bg-popover p-0 text-popover-foreground shadow-lg w-96">Body</dialog>',
    );
  });
});

describe("Dialog.Trigger", () => {
  it("renders a <button> invoker with command=show-modal targeting the dialog", async () => {
    expect(await render(<Dialog.Trigger for='confirm'>Open</Dialog.Trigger>)).toBe(
      '<button type="button" data-slot="dialog-trigger" command="show-modal" commandfor="confirm">Open</button>',
    );
  });
});

describe("Dialog.Close", () => {
  it("emits command=close by default", async () => {
    expect(await render(<Dialog.Close for='confirm'>Cancel</Dialog.Close>)).toBe(
      '<button type="button" data-slot="dialog-close" command="close" commandfor="confirm">Cancel</button>',
    );
  });

  it("emits command=request-close when request is set", async () => {
    expect(
      await render(
        <Dialog.Close for='confirm' request>
          Cancel
        </Dialog.Close>,
      ),
    ).toBe('<button type="button" data-slot="dialog-close" command="request-close" commandfor="confirm">Cancel</button>');
  });

  it("merges a custom class", async () => {
    expect(
      await render(
        <Dialog.Close for='confirm' class='text-sm'>
          Cancel
        </Dialog.Close>,
      ),
    ).toBe('<button type="button" data-slot="dialog-close" command="close" commandfor="confirm" class="text-sm">Cancel</button>');
  });
});

describe("Dialog composition", () => {
  it("renders trigger + dialog + close linked by a shared id", async () => {
    expect(
      await render(
        <>
          <Dialog.Trigger for='confirm'>Delete…</Dialog.Trigger>
          <Dialog id='confirm'>
            <p>Are you sure?</p>
            <Dialog.Close for='confirm'>Cancel</Dialog.Close>
          </Dialog>
        </>,
      ),
    ).toBe(
      '<button type="button" data-slot="dialog-trigger" command="show-modal" commandfor="confirm">Delete…</button><dialog id="confirm" data-slot="dialog" class="rounded-xl border border-border bg-popover p-0 text-popover-foreground shadow-lg"><p>Are you sure?</p><button type="button" data-slot="dialog-close" command="close" commandfor="confirm">Cancel</button></dialog>',
    );
  });
});
