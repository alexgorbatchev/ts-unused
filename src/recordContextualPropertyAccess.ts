import { ts, type SourceFile } from "ts-morph";
import type { PropertyAccesses, PropertyAccessName } from "./types.js";
import { getPropertyNameSymbols } from "./getPropertyNameSymbols.js";
import { recordPropertySymbols } from "./recordPropertySymbols.js";

/** Records contextual writes, preserving branch-specific properties of discriminated unions. */
export function recordContextualPropertyAccess(
  expression: ts.Expression,
  name: PropertyAccessName,
  accesses: PropertyAccesses,
  checker: ts.TypeChecker,
  sourceFile: SourceFile,
): void {
  const contextual = checker.getContextualType(expression);
  if (!contextual) {
    return;
  }
  const apparent = checker.getApparentType(contextual);
  const targets = (apparent.isUnion() ? apparent.types : [apparent]).map((type) => ({
    type,
    properties: getPropertyNameSymbols(name, type, checker),
  }));
  const roots = new Set(
    targets.flatMap((target) => target.properties.flatMap((property) => checker.getRootSymbols(property))),
  );
  let selected = targets;
  if (targets.length > 1 && (roots.size !== 1 || targets.some((target) => target.properties.length === 0))) {
    const actual = checker.getTypeAtLocation(expression);
    const compatible = targets.filter((target) => checker.isTypeAssignableTo(actual, target.type));
    if (compatible.length > 0) {
      selected = compatible;
    }
  }
  recordPropertySymbols(
    accesses,
    checker,
    selected.flatMap((target) => target.properties),
    sourceFile,
  );
}
