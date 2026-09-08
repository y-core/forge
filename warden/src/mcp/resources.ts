import { renderCatalogue } from "../catalogue/render";
import { parseCorpus } from "../corpus/ident";
import type { Knowledge } from "../index/open";
import { readDocument } from "../search/read";

/** A fixed resource, as MCP's `resources/list` returns it. @public */
export interface ResourceSpec {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/** A parameterised resource, as `resources/templates/list` returns it. @public */
export interface ResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

/** The one fixed resource.
 *
 *  The catalogue is a resource rather than a tool because it is addressable content: a host can pin
 *  it into context at session start without spending a model turn asking for it, which is the whole
 *  reason resources exist. @public */
export const RESOURCES: readonly ResourceSpec[] = [
  {
    uri: "knowledge://catalogue",
    name: "Catalogue",
    description: "Every governing document, with the sentence its own frontmatter uses to describe it. Read this first.",
    mimeType: "text/markdown",
  },
];

/** One template per corpus. @public */
export const TEMPLATES: readonly ResourceTemplate[] = [
  {
    uriTemplate: "knowledge://canon/{path}",
    name: "Canon document",
    description: "One document of the fleet canon, whole.",
    mimeType: "text/markdown",
  },
  {
    uriTemplate: "knowledge://project/{path}",
    name: "Repository document",
    description: "One of this repository's own governing documents, whole.",
    mimeType: "text/markdown",
  },
  {
    uriTemplate: "knowledge://dependency/{path}",
    name: "Library document",
    description: "One consumer-facing document of the installed library, whole. Advisory: it governs the library, not this repository.",
    mimeType: "text/markdown",
  },
];

/** One resource's contents, in MCP's shape. @public */
export interface ResourceContents {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}

/** Reads one resource by URI, or `undefined` when the URI names none. @public */
export function readResource(knowledge: Knowledge, uri: string): ResourceContents | undefined {
  if (uri === "knowledge://catalogue") {
    return { contents: [{ uri, mimeType: "text/markdown", text: renderCatalogue(knowledge.db, { local: true }) }] };
  }

  // The corpus comes out of the URI rather than being inferred from which pattern failed: with a
  // third template, "not canon" stopped meaning "project".
  const matched = uri.match(/^knowledge:\/\/([a-z]+)\/(.+)$/);
  const corpus = parseCorpus(matched?.[1] ?? "");
  const path = matched?.[2];
  if (corpus === undefined || path === undefined) return undefined;

  const sections = readDocument(knowledge.db, path).filter((section) => section.corpus === corpus);
  if (sections.length === 0) return undefined;

  const body = sections.map((section) => `## ${section.section}. ${section.title}\n\n${section.body}`).join("\n\n");
  return { contents: [{ uri, mimeType: "text/markdown", text: body }] };
}
