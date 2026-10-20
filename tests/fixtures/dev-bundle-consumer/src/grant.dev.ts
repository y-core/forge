import { reveal } from "./reveal.dev";

export function grant(): string {
  return reveal("granted");
}
