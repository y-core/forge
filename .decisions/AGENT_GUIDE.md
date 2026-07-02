---
title: Agent and MCP Document Guide
description: "document structure rules, section numbering convention, frontmatter requirements, keyword-dense titles, cross-referencing format, tsmcp MCP server compatibility, decisions_read section access, decisions_search optimization, document size guidelines, quick reference convention"
weight: 5
---

# Agent and MCP Document Guide

> This guide is the authoritative source for how `.decisions/` documents should be
> written and structured so that the `tsmcp` MCP server can expose them with maximum
> precision and search efficiency.
>
> All new and updated governing documents must follow these rules.

---

## 0. Quick Reference

- §1 MCP Server Access Model: three tools — `decisions_list`, `decisions_search`, `decisions_read` — and when to use each
- §2 Section Numbering Convention: `## N.` and `### Na.` format, forbidden dot-notation patterns
- §3 Section Title Guidelines: keyword-dense titles score 10× in search — domain noun + mechanism/pattern required
- §4 Frontmatter Requirements: `title`, `description` (comma-separated keywords), `weight` (int) — all mandatory
- §5 Cross-Reference Format: inter-doc markdown links, intra-doc `§N` shorthand, CLAUDE.md registration
- §6 Document Size Guidelines: 200–600 lines target, split when concerns are independently searchable
- §7 Quick Reference Section Convention: `## 0.` placement, 5–10 bullets, keep current

---

## 1. MCP Server Document Access Model

The `tsmcp` MCP server provides three tools for accessing `.decisions/` documents.
Understanding how each works guides structural decisions.

### 1a. decisions_list — Document and Section Discovery

Returns all documents with their title, description, weight, and a hierarchical section
index (numbers and titles for all `##` and `###` sections). Agents use this first to
find which document to read and which section to target.

**Token cost:** ~80 lines for 12 documents. Always the entry point.

### 1b. decisions_search — Keyword-Ranked Section Retrieval

Tokenises the query into terms and scores every section across all documents:

```
+10 points  per query term found in the section title
 +1 point   per query term found in the section body
```

Returns the top N sections (default 10) with a 3-line content preview.

**Implications for authoring:**
- A title containing the right keyword is worth 10× the same word in the body
- Generic titles (`### Rules`, `### Setup`) score zero for most domain queries
- Keyword-rich titles surface the right section without the agent having to read full docs

**Token cost:** ~50 lines for 10 results. The primary search tool.

### 1c. decisions_read — Section-Precise Retrieval

Retrieves a document or a specific section by number or title substring:

```
mcp__tsmcp__decisions_read({"doc": "NAMESPACE_DESIGN.md", "section": "5c"})   # precise, preferred
mcp__tsmcp__decisions_read({"doc": "NAMESPACE_DESIGN.md", "section": "Barrel Export Rules"})  # title match, fragile
```

If `section` is omitted, the full document is returned (expensive; use only as last resort).
For `##`-level sections, all nested `###` subsections are included automatically.

**Implications for authoring:**
- Numbered sections are directly addressable; unnumbered sections require title substring matching
- A misspelled or ambiguous title makes the section unreachable by number — numbering is mandatory

**Token cost per section read:** typically 30–150 lines.

---

## 2. Section Numbering Convention

The MCP parser extracts section numbers from headers by splitting on the first `.`:

- `## 5. Title` → `number="5"`, `title="Title"`
- `### 5a. Title` → `number="5a"`, `title="Title"`
- `## 10b. Long Title` → `number="10b"`, `title="Long Title"`

**Valid number format:** starts with a digit (`0–9`), followed by zero or more alphanumeric
characters (`0–9`, `a–z`, `A–Z`). Examples: `1`, `2a`, `5c`, `10b`, `0`.

When documenting heading syntax in a `.decisions/` file, indent sample headings or
prefix them with list markers. Literal column-1 `##` / `###` examples are parsed as
real sections by `tsmcp`.

### 2a. Level-2 Section Numbering (`##`)

Use sequential integers starting from 1. Reserve `0` for the Quick Reference section:

    ## 0. Quick Reference
    ## 1. First Major Topic
    ## 2. Second Major Topic
    ## 2a. Sub-topic of 2 (when a topic requires subordinate grouping)
    ## 3. Third Major Topic

The `Na.` pattern for `##` sections (e.g., `## 2a.`) is appropriate only when a topic
needs a related but distinct grouping that does not warrant its own document.

### 2b. Level-3 Subsection Numbering (`###`)

Use the parent section number as a prefix, followed by a lowercase letter:

    ## 3. Route Handler Patterns
    ### 3a. Route Controller Action and Context Typing
    ### 3b. Middleware Composition and Execution Order
    ### 3c. Error Boundary and Response Shape
    ### 3d. Cloudflare Workers Bindings Access Pattern

Letters continue alphabetically: `3a`, `3b`, `3c`, ... `3z`. For sections with more than
26 subsections, continue with `3aa`, `3ab`, etc. (rare in practice).

### 2c. Forbidden Patterns

These formats are silently broken by the parser:

    ### 1.1 Title      ← parser extracts "1", not "1.1" — collides with parent ## 1
    ### 2.3 Title      ← same problem
    ### Title          ← no number at all — only reachable by fragile title substring match
    ## Title           ← no number — same problem

---

## 3. Section Title Guidelines

Section titles are the highest-leverage place to improve search quality. The
`decisions_search` scoring function weights title matches at 10×.

### 3a. Include the Domain Noun

Every title should name the specific concept, pattern, or mechanism it covers.
Avoid titles that are meaningful only in context:

| Avoid | Prefer |
|---|---|
| `### Rules` | `### 3f. Barrel Export Rules and Constraints` |
| `### Setup` | `### 1a. createApp Factory Setup and Configuration` |
| `### Implementation` | `### 3b. Cloudflare Workers KV Implementation with Bindings` |
| `### Basic usage` | `### 4a. HTMX Partial Render Basic Usage and Swap Targets` |
| `### Structure` | `### 3a. Route Handler Struct and Dependency Structure` |

### 3b. Include the Mechanism or Pattern Name

When a subsection describes a known pattern, name the pattern in the title:

| Avoid | Prefer |
|---|---|
| `### The mod.ts Pattern` | `### 1a. mod.ts Barrel Export and Namespace Catalog Pattern` |
| `### Routes` | `### 5a. createController Action Map and app.map Registration` |
| `### Domain Errors` | `### 1b. Domain Error Sentinels and HTTP Status Mapping` |
| `### Interface at the consumer` | `### 4a. Service Interface Defined at Consumer Layer` |
| `### Security headers` | `### 6b. createSecurityHeaders CSP Nonce Injection Pattern` |

### 3c. Use Parallel Title Structure Within a Section

Subsections within the same parent should follow a consistent grammatical pattern.
A parent covering rules might use `### Na. X Rule — Constraint/Consequence`. A parent
covering patterns might use `### Na. Pattern Name and Use Cases`. Consistency makes
`decisions_list` output easier to scan.

### 3d. Target Length

Titles should be 3–8 words. Short enough to scan in `decisions_list`; long enough to
contain keywords. Avoid titles exceeding 10 words.

---

## 4. Frontmatter Requirements

Every `.decisions/` document must have YAML frontmatter at the top:

    ---
    title: Short Human-Readable Title
    description: "keyword one, keyword two, keyword three, ..."
    weight: 15
    ---

### 4a. Title Field

Used in `decisions_list` output and as the document's display name. Should be short
(2–5 words), title-cased, and match the file's primary concern.

### 4b. Description Field

Scanned by `decisions_search` at the document level. Write as a comma-separated list
of searchable terms — not a prose sentence. Include:
- Key concepts covered in the document
- Names of patterns, tools, or mechanisms (e.g., `mod.ts`, `barrel exports`, `validate-exports`)
- Alternative phrasings agents might search for

Good example:

    description: "barrel exports, mod.ts pattern, namespace catalog, validate-exports, app.map route registration, Cloudflare Workers bindings, CSP nonce, security headers, HTMX partial render, Tailwind v4 theme tokens"

Avoid:

    description: "Governing patterns for TypeScript module exports — barrel files, namespace design, route registration, and the mod.ts catalog pattern."

### 4c. Weight Field

Controls ordering in `decisions_list` output and is used as a tiebreaker in
`decisions_search` (lower weight = higher priority). Assign weights by importance/access
frequency:

| Range | Purpose |
|---|---|
| 1–10 | Meta-documents (this guide, project-level rules) |
| 11–20 | Architectural foundations (project structure, core rules) |
| 21–30 | Implementation patterns (middleware, logging, validation) |
| 31–40 | Specialised guides (concurrency, UI, data storage) |
| 41+ | Reference-only documents (review checklists, sources) |

---

## 5. Cross-Reference Format

### 5a. Inter-Document Links

Use standard markdown links to reference other `.decisions/` documents:

```markdown
See [Section 5](./ERROR_HANDLING.md) for the domain error sentinel pattern.
Complements [NAMESPACE_DESIGN.md](./NAMESPACE_DESIGN.md) §3.
```

The MCP server's `decisions_read` response automatically detects markdown links to other
`.md` files and appends them as a "Related:" footer, making them visible to agents without
reading the full section.

### 5b. Intra-Document Section References

When referencing sections within the same document, use the `§N` shorthand inline:

```markdown
See §5a for the cross-reference format before reading this section.
The export validation rule (§3f) interacts with barrel catalog requirements (§3a).
```

### 5c. CLAUDE.md Registration

Every new `.decisions/` document must be added to the Guide Index in `CLAUDE.md` with
a one-line description of its topic.

---

## 6. Document Size Guidelines

### 6a. Target Size and Warning Threshold

- **Target:** 200–600 lines per document
- **Warning:** `decisions_read` warns when a document exceeds 500 lines without a `section` parameter — agents will be discouraged from reading the full document
- **Hard limit signal:** Documents exceeding 800 lines typically cover multiple independent concerns and should be split

### 6b. When to Split a Document

Split a document when it covers concerns that an agent would search for independently.
The test: if two different queries would lead to the same document for unrelated reasons,
the document covers too many concerns.

Indicators of a split:
- Two `##` sections have no cross-references to each other
- The document's frontmatter description covers 3+ unrelated topics
- The document exceeds 600 lines

### 6c. Subsection Size Target

Each `###` subsection should be 20–100 lines. Subsections shorter than 15 lines may
belong as a paragraph in the parent `##` section. Subsections longer than 150 lines
should be reviewed for further subdivision.

---

## 7. Quick Reference Section Convention

### 7a. Placement and Format

Every document must begin with a `## 0. Quick Reference` section immediately after the
introductory blockquote. It should contain 5–10 bullet points covering the document's
key topics and their section numbers:

    ## 0. Quick Reference

    - §1 Topic one: brief description of what agents find here
    - §2 Topic two: key pattern or rule name
    - §3a Specific subsection: when this is the primary entry point
    - §4 Topic four: include named tools or patterns

### 7b. Purpose

The Quick Reference serves as a map that lets an agent decide which section to request
without reading the full document. An agent reading `## 0. Quick Reference` (~30 lines)
gets enough context to call `mcp__tsmcp__decisions_read({"doc": "AGENT_GUIDE.md", "section": "3a"})` directly,
avoiding a full document load.

### 7c. Keep It Current

When adding new sections to a document, update `## 0. Quick Reference` to include them.
Stale Quick Reference sections that omit important sections reduce navigation efficiency.
