import type { ControlsDemoState } from "./types";
// Internal by design: this is the showcase's own demo state, not a contract a consumer implements.
/** Resumable-scope name the bound-control band stamps and the client scope registers. @internal */
export const CONTROLS_DEMO_SCOPE = "show-controls";

/** The band's server-rendered state, and the single source every control paints from. @internal */
export const CONTROLS_DEMO_STATE: ControlsDemoState = {
  text: "Ada Lovelace",
  email: "",
  unit: "mm",
  precision: "in",
  level: 40,
  zoom: 100,
  enabled: true,
  notifications: false,
  notes: "Two lines of notes.",
  summary: "",
  align: "center",
  weight: "bold",
  mirror: "type here",
  count: 3,
  bold: true,
  plan: "standard",
  toppings: ["olives", "basil"],
  avatar: "",
  code: "",
  pin: "1234",
};

/** Formats a bound signal value for its readout, on the server and in the browser alike. @internal */
export function controlsReadout(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "(none)" : value.join(", ");
  if (typeof value === "boolean") return value ? "on" : "off";
  const text = String(value);
  return text === "" ? "(empty)" : text;
}
