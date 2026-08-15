// Lazy on purpose: the readout can only go stale once the input has been moved, and that same
// `input` event is what resumes the scope — so a page of untouched sliders pays nothing.
/** Resumable-scope name a `Slider` with an `<output>` readout stamps. Lazy. @public */
export const SLIDER_SCOPE = "slider";

/** The action the slider input names in `data-on-input` and the client scope handles. @public */
export type SliderAction = "sync";
