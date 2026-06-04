/** @jsxImportSource @y-core/forge */
import type { FC } from "hono/jsx";
import type { AlertVariant } from "../core/alert";
import { Alert } from "../core/alert";
import { oobAppend } from "./htmx-patterns";

export type FlashType = "success" | "info" | "warning" | "error";

export interface FlashMessage {
  type: FlashType;
  text: string;
}

function variantFor(t: FlashType): AlertVariant {
  if (t === "error") return "destructive";
  return t;
}

export const Flash: FC<{ messages?: FlashMessage[] }> = ({ messages }) => {
  if (!messages || messages.length === 0) return null;
  return (
    <>
      {messages.map((m, i) => (
        <Alert key={i} variant={variantFor(m.type)} dismissible>
          <Alert.Description>{m.text}</Alert.Description>
        </Alert>
      ))}
    </>
  );
};

export const FlashOob: FC<{ messages?: FlashMessage[] }> = ({ messages }) => {
  if (!messages || messages.length === 0) return null;
  return (
    <>
      {messages.map((m, i) => (
        <div key={i} {...oobAppend("#flash")}>
          <Alert variant={variantFor(m.type)} dismissible>
            <Alert.Description>{m.text}</Alert.Description>
          </Alert>
        </div>
      ))}
    </>
  );
};

export const FlashContainer: FC<{ messages?: FlashMessage[] }> = ({ messages }) => (
  <div id="flash" class="grid gap-2" aria-live="polite">
    <Flash messages={messages ?? []} />
  </div>
);
