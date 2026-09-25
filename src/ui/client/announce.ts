import {
  ANNOUNCE_BUSY_CHANNEL,
  ANNOUNCE_FAILURE_ATTR,
  ANNOUNCE_FAILURE_CHANNEL,
  ANNOUNCE_FORM_ERROR_CHANNEL,
  ANNOUNCE_LINGER_MS,
  ANNOUNCE_SETTLE_MS,
  ANNOUNCE_TOAST_CHANNEL,
  ANNOUNCER_REGION_SLOTS,
} from "../contracts/announcer-contract";
import type { AnnouncePoliteness } from "../contracts/types";
import { ownerDocument, ownerWindow } from "./dom";
import type { AnnounceOptions } from "./types";

interface AnnounceChannel {
  timer: number;
  spoken: string | undefined;
  queued: string[];
}

interface DocumentAnnouncer {
  channels: Map<string, AnnounceChannel>;
  warned: boolean;
}

const FIELD_ERROR_SELECTOR = "[data-slot~='field-error']";
const SPINNER_SELECTOR = "[data-slot~='spinner']";
const FAILURE_SELECTOR = `[${ANNOUNCE_FAILURE_ATTR}]`;

const announcers = new WeakMap<Document, DocumentAnnouncer>();

function announcerOf(doc: Document): DocumentAnnouncer {
  const existing = announcers.get(doc);
  if (existing) return existing;
  const created: DocumentAnnouncer = { channels: new Map(), warned: false };
  announcers.set(doc, created);
  return created;
}

function channelOf(announcer: DocumentAnnouncer, name: string): AnnounceChannel {
  const existing = announcer.channels.get(name);
  if (existing) return existing;
  const created: AnnounceChannel = { timer: 0, spoken: undefined, queued: [] };
  announcer.channels.set(name, created);
  return created;
}

function announcerRegion(doc: Document, politeness: AnnouncePoliteness): HTMLElement | null {
  return doc.querySelector<HTMLElement>(`[data-slot~='${ANNOUNCER_REGION_SLOTS[politeness]}']`);
}

function appendMessage(doc: Document, region: HTMLElement, message: string): void {
  const node = doc.createElement("div");
  node.textContent = message;
  region.appendChild(node);
  ownerWindow(doc).setTimeout(() => node.remove(), ANNOUNCE_LINGER_MS);
}

function queueAnnouncement(text: string, options: AnnounceOptions, keepQueued: boolean): void {
  const { channel = "default", politeness = "polite", repeat = false, within } = options;
  const doc = ownerDocument(within);
  const win = ownerWindow(doc);
  const announcer = announcerOf(doc);
  const pending = channelOf(announcer, channel);
  win.clearTimeout(pending.timer);
  pending.timer = 0;
  const message = text.trim();
  if (message === "") {
    pending.queued = [];
    pending.spoken = undefined;
    return;
  }
  if (!announcerRegion(doc, politeness)) {
    if (!announcer.warned) console.warn("[announce] no <Announcer /> in this document; stamp one in the page layout to be heard");
    announcer.warned = true;
    return;
  }
  pending.queued = keepQueued ? [...pending.queued, message] : [message];
  pending.timer = win.setTimeout(() => {
    pending.timer = 0;
    const messages = pending.queued;
    pending.queued = [];
    const region = announcerRegion(doc, politeness);
    if (!region) return;
    for (const queued of messages) {
      if (!repeat && pending.spoken === queued) continue;
      appendMessage(doc, region, queued);
      pending.spoken = queued;
    }
  }, ANNOUNCE_SETTLE_MS);
}

/** Speaks `text` through the page's `<Announcer />`, the latest message on a channel winning once it settles; empty text cancels. @public */
export function announce(text: string, options: AnnounceOptions = {}): void {
  queueAnnouncement(text, options, false);
}

/** Speaks a toast's text on the toast channel, where a burst is spoken whole rather than as its latest. @internal */
export function announceToast(text: string, within: Node): void {
  queueAnnouncement(text, { channel: ANNOUNCE_TOAST_CHANNEL, repeat: true, within }, true);
}

function matchesAt(root: Element | Document, selector: string): HTMLElement[] {
  const self = (root as Partial<Element>).matches?.(selector) ? [root as HTMLElement] : [];
  return [...self, ...root.querySelectorAll<HTMLElement>(selector)];
}

/** Announces the first field error at or below `root` assertively, as the summary of a failed submission. @internal */
export function announceFieldError(root: Element | Document): void {
  const [error] = matchesAt(root, FIELD_ERROR_SELECTOR);
  if (error) announce(error.textContent ?? "", { channel: ANNOUNCE_FORM_ERROR_CHANNEL, politeness: "assertive", repeat: true, within: root });
}

/** Announces the message of the first failure panel at or below `root` assertively, on the failure channel. @internal */
export function announceFailure(root: Element | Document): void {
  const [panel] = matchesAt(root, FAILURE_SELECTOR);
  if (panel)
    announce(panel.getAttribute(ANNOUNCE_FAILURE_ATTR) ?? "", {
      channel: ANNOUNCE_FAILURE_CHANNEL,
      politeness: "assertive",
      repeat: true,
      within: root,
    });
}

/** Announces the label of the first spinner at or below `root` that `shown` accepts, on the busy channel. @internal */
export function announceSpinner(root: Element | Document, shown: (spinner: Element) => boolean): void {
  const spinner = matchesAt(root, SPINNER_SELECTOR).find(shown);
  if (spinner) announce(spinner.textContent ?? "", { channel: ANNOUNCE_BUSY_CHANNEL, repeat: true, within: root });
}
