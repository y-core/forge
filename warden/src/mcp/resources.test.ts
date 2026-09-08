import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { openIndex } from "../index/open";
import { CORPORA } from "../types";
import { readResource, RESOURCES, TEMPLATES } from "./resources";

const DOC =
  '---\ntitle: Rules\ndescription: "Six rules."\n---\n\n## 0. Quick Reference\n\n- §1 One: the comment budget\n\n## 1. One\n\nThe comment budget is a ceiling.\n';

const root = mkdtempSync(join(tmpdir(), "warden-resources-"));
const canonRoot = join(root, "canon");
for (const path of [join(root, "docs/A.md"), join(canonRoot, "libs/CODE_RULES.md"), join(canonRoot, "shared/AGENT_GUIDE.md")]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, DOC, "utf-8");
}
const knowledge = openIndex(root, "libs", { path: ":memory:", canonRoot, canonVersion: "1.0.0" });

describe("RESOURCES and TEMPLATES", () => {
  it("declares the catalogue fixed and every corpus parameterised", () => {
    expect(RESOURCES.map((resource) => resource.uri)).toEqual(["knowledge://catalogue"]);
    expect(TEMPLATES.map((template) => template.uriTemplate)).toEqual([
      "knowledge://canon/{path}",
      "knowledge://project/{path}",
      "knowledge://dependency/{path}",
    ]);
  });

  it("offers one template per corpus, so a corpus cannot be served and left unaddressable", () => {
    expect(TEMPLATES).toHaveLength(CORPORA.length);
  });
});

describe("readResource()", () => {
  it("serves the catalogue, which is what a host pins without spending a model turn", () => {
    expect(readResource(knowledge, "knowledge://catalogue")?.contents[0]?.text).toContain("CODE_RULES.md");
  });

  it("serves both corpora in the catalogue — canon alone answers half of what governs a repository", () => {
    const text = readResource(knowledge, "knowledge://catalogue")?.contents[0]?.text;
    expect(text).toContain("## This repository — its own documents");
    expect(text).toContain("docs/A.md");
  });

  it("serves one canon document whole, addressed by path alone", () => {
    expect(readResource(knowledge, "knowledge://canon/CODE_RULES.md")?.contents[0]?.text).toContain("The comment budget is a ceiling.");
  });

  it("serves one of this repository's own documents", () => {
    expect(readResource(knowledge, "knowledge://project/docs/A.md")?.contents[0]?.text).toContain("The comment budget is a ceiling.");
  });

  it("does not serve a project document under the canon template, or the reverse", () => {
    expect(readResource(knowledge, "knowledge://canon/docs/A.md")).toBeUndefined();
    expect(readResource(knowledge, "knowledge://project/CODE_RULES.md")).toBeUndefined();
  });

  it("returns undefined for a URI it does not serve, so the caller answers with an error", () => {
    expect(readResource(knowledge, "knowledge://nowhere")).toBeUndefined();
    expect(readResource(knowledge, "https://example.com")).toBeUndefined();
  });
});
