import { reporter } from "../report.ts";
import type { AstNode, LintRule } from "../types.ts";

/** An optional property signature, with the annotation whose union has to admit `undefined`. */
interface PropertySignatureNode extends AstNode {
  optional?: boolean | undefined;
  key?: (AstNode & { name?: string | undefined }) | undefined;
  typeAnnotation?: { typeAnnotation?: AstNode | undefined } | undefined;
}

function admitsUndefined(annotation: AstNode | undefined): boolean {
  if (annotation === undefined) return true;
  if (annotation.type === "TSUndefinedKeyword" || annotation.type === "TSAnyKeyword" || annotation.type === "TSUnknownKeyword") return true;
  if (annotation.type !== "TSUnionType") return false;
  return ((annotation as unknown as { types: readonly AstNode[] }).types ?? []).some((member) => admitsUndefined(member));
}

/** An optional property a consumer passes a value into, declared without `| undefined`. */
export const optionalPropUndefined: LintRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Under `exactOptionalPropertyTypes`, a bare `?:` forces a consumer into a guard-form spread that `jsx-a11y` cannot read.",
    },
  },
  create(context) {
    const report = reporter(context, "forge-ui-optional-prop-undefined");
    return {
      TSPropertySignature(node: AstNode) {
        const property = node as PropertySignatureNode;
        if (property.optional !== true) return;
        if (admitsUndefined(property.typeAnnotation?.typeAnnotation)) return;
        const name = property.key?.name ?? "this property";
        report(`\`${name}?:\` omits \`| undefined\` — a consumer must then spread it conditionally, which no a11y rule can see through`, node.loc);
      },
    };
  },
};
