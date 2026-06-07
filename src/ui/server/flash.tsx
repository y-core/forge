/** @jsxImportSource @y-core/forge */

import { oobSwap } from "../../html/htmx/htmx-patterns";
import type { FC } from "../../jsx/types";
import type { ToastPosition, ToastVariant } from "../core/toast";
import { Toast } from "../core/toast";

export type FlashType = "success" | "info" | "warning" | "error";

export interface FlashMessage {
  type: FlashType;
  text: string;
  title?: string;
}

function variantFor(t: FlashType): ToastVariant {
  if (t === "error") return "destructive";
  return t;
}

const FlashToast: FC<{ message: FlashMessage }> = ({ message }) => (
  <Toast variant={variantFor(message.type)} dismissible>
    {message.title ? <Toast.Title>{message.title}</Toast.Title> : null}
    <Toast.Description>{message.text}</Toast.Description>
  </Toast>
);

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

export const FlashContainer: FC<{ messages?: FlashMessage[]; position?: ToastPosition }> = ({ messages, position }) => {
  const pos: ToastPosition = position ?? "bottom-right";
  return (
    <Toast.Container id='flash-container' position={pos}>
      <Flash messages={messages ?? []} />
    </Toast.Container>
  );
};
