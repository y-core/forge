import { programmaticStop, removeRehomingFocus } from "./dismiss";

/** Where focus goes when the alert holding it leaves: the element that contained it. */
// Not the next tabbable element after the alert, which would move the user forward past content they
// have not read. `<body>` is excluded: focus falls there anyway, and a stop written on it stays.
function rehomeTarget(root: HTMLElement): HTMLElement | null {
  const parent = root.parentElement;
  if (!parent || parent === parent.ownerDocument.body) return null;
  return programmaticStop(parent);
}

/** Removes a dismissible alert, rehoming focus first when its dismiss button holds it. @internal */
export function dismissAlert(root: HTMLElement): void {
  removeRehomingFocus(root, rehomeTarget);
}
