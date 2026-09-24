/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { scriptJson } from "../http/html";
import type { JSXNode } from "../jsx/types";
import type { MetaOptions, MetaTag, PageMeta, RobotsDirective } from "./types";

/** A `robots` value as the one string the tag carries. */
function robotsContent(robots: RobotsDirective | readonly RobotsDirective[]): string {
  return typeof robots === "string" ? robots : robots.join(", ");
}

/** One `extra` entry as its element. */
function extraTag(tag: MetaTag): JSXNode {
  if ("tagName" in tag) return <link rel={tag.rel} href={tag.href} />;
  if ("property" in tag) return <meta property={tag.property} content={tag.content} />;
  return <meta name={tag.name} content={tag.content} />;
}

/** Renders a page's `<head>` children — the one place a descriptor becomes markup. @public */
export function metaTags(meta: PageMeta, options: MetaOptions = {}): JSXNode {
  const { og, twitter } = meta;
  return [
    <title>{meta.title}</title>,
    meta.description === undefined ? null : <meta name='description' content={meta.description} />,
    meta.canonical === undefined ? null : <link rel='canonical' href={meta.canonical} />,
    meta.robots === undefined ? null : <meta name='robots' content={robotsContent(meta.robots)} />,
    og?.title === undefined ? null : <meta property='og:title' content={og.title} />,
    og?.description === undefined ? null : <meta property='og:description' content={og.description} />,
    og?.type === undefined ? null : <meta property='og:type' content={og.type} />,
    og?.image === undefined ? null : <meta property='og:image' content={og.image} />,
    og?.url === undefined ? null : <meta property='og:url' content={og.url} />,
    twitter?.card === undefined ? null : <meta name='twitter:card' content={twitter.card} />,
    twitter?.title === undefined ? null : <meta name='twitter:title' content={twitter.title} />,
    twitter?.description === undefined ? null : <meta name='twitter:description' content={twitter.description} />,
    meta.jsonLd === undefined || options.nonce === undefined ? null : (
      <script type='application/ld+json' nonce={options.nonce}>
        {scriptJson(meta.jsonLd)}
      </script>
    ),
    ...(meta.extra ?? []).map(extraTag),
  ];
}

// Spreading instead would drop a base `og` whole the first time a page states one field of it.
/** Merges a page's descriptor over the site-wide one, `og` and `twitter` a level deep. @public */
export function mergeMeta(base: PageMeta, page: Partial<PageMeta>): PageMeta {
  return {
    ...base,
    ...page,
    ...(base.og === undefined && page.og === undefined ? {} : { og: { ...base.og, ...page.og } }),
    ...(base.twitter === undefined && page.twitter === undefined ? {} : { twitter: { ...base.twitter, ...page.twitter } }),
    ...(base.extra === undefined && page.extra === undefined ? {} : { extra: [...(base.extra ?? []), ...(page.extra ?? [])] }),
  };
}
