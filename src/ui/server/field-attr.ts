/** The SSR `data-field` attribute naming the signal field a control two-way-binds to. @public */
export function fieldAttr(name: string): { "data-field": string } {
  return { "data-field": name };
}
