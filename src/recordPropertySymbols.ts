import { ts, type SourceFile } from "ts-morph";
import type { PropertyAccesses } from "./types.js";

/** Records actual property uses, following native symbol origins and explicit class/interface heritage. */
export function recordPropertySymbols(
  accesses: PropertyAccesses,
  checker: ts.TypeChecker,
  symbols: readonly ts.Symbol[],
  sourceFile: SourceFile,
): void {
  for (const symbol of symbols) {
    for (const root of checker.getRootSymbols(symbol)) {
      for (const declaration of root.declarations ?? []) {
        if (!ts.isPropertySignature(declaration) && !ts.isPropertyDeclaration(declaration)) {
          continue;
        }
        const files = accesses.get(declaration) ?? new Set<SourceFile>();
        if (files.has(sourceFile)) {
          continue;
        }
        files.add(sourceFile);
        accesses.set(declaration, files);
        const owner = declaration.parent;
        if (!ts.isClassLike(owner) && !ts.isInterfaceDeclaration(owner)) {
          continue;
        }
        for (const clause of owner.heritageClauses ?? []) {
          for (const base of clause.types) {
            const inherited = checker.getPropertyOfType(checker.getTypeAtLocation(base), root.getName());
            if (inherited) {
              recordPropertySymbols(accesses, checker, [inherited], sourceFile);
            }
          }
        }
      }
    }
  }
}
