/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { oobSwap } from "../../html/htmx/htmx-patterns";
import type { FC } from "../../jsx/types";
import type { ToastPosition, ToastVariant } from "../core/toast";
import { Toast } from "../core/toast";

/** The severity of a flash message. @public */
export type FlashType = "success" | "info" | "warning" | "error";

/** One flash message carried across a redirect. @public */
export interface FlashMessage {
  type: FlashType;
  text: string;
  title?: string;
}

const FLASH_DURATION_MS = 5000;

function variantFor(t: FlashType): ToastVariant {
  if (t === "error") return "destructive";
  return t;
}

const FlashToast: FC<{ message: FlashMessage }> = ({ message }) => (
  <Toast variant={variantFor(message.type)} dismissible duration={FLASH_DURATION_MS}>
    {message.title ? <Toast.Title>{message.title}</Toast.Title> : null}
    <Toast.Description>{message.text}</Toast.Description>
  </Toast>
);

/** Renders each flash message as a dismissible toast. @public */
export const Flash: FC<{ messages?: FlashMessage[] }> = ({ messages }) => {
  if (!messages || messages.length === 0) return null;
  return (
    <>
      {messages.map((m, i) => (
        <FlashToast key={i} message={m} />
      ))}
    </>
  );
};

/** Renders flash messages as htmx out-of-band swaps into an existing container. @public */
export const FlashOob: FC<{ messages?: FlashMessage[]; selector?: string; strategy?: string }> = ({ messages, selector, strategy }) => {
  if (!messages || messages.length === 0) return null;
  const oobAttrs = oobSwap({ strategy: strategy ?? "beforeend", selector: selector ?? "#flash-container" });
  return (
    <>
      {messages.map((m, i) => (
        <div key={i} {...oobAttrs}>
          <FlashToast message={m} />
        </div>
      ))}
    </>
  );
};

/** The toast container flash messages are rendered and swapped into. @public */
export const FlashContainer: FC<{ messages?: FlashMessage[]; position?: ToastPosition }> = ({ messages, position }) => {
  const pos: ToastPosition = position ?? "bottom-right";
  return (
    <Toast.Container id='flash-container' position={pos}>
      <Flash messages={messages ?? []} />
    </Toast.Container>
  );
};
