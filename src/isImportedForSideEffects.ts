import { Node, type SourceFile } from "ts-morph";

/**
 * Whether another file imports this module only to run it (`import "./setup"`). A side-effect import uses no
 * export, so the exports are still reported one by one, but it needs the file itself: deleting the file would
 * break the importer and drop the side effects.
 */
export function isImportedForSideEffects(sourceFile: SourceFile): boolean {
  return sourceFile
    .getReferencingNodesInOtherSourceFiles()
    .some((node) => Node.isImportDeclaration(node) && node.getImportClause() === undefined);
}
