import {
  isImportDeclaration,
  isModuleBlock,
  isModuleDeclaration,
  isNamespaceImport,
  isSourceFile,
  type ImportDeclaration,
  type Node,
} from "typescript/ast";
import type { Project } from "typescript/async";
import { findNativeReferenceNodes } from "./findNativeReferenceNodes.js";
import { getRelevantProgramFileNames } from "./getRelevantProgramFileNames.js";
import { isNamespaceMemberAccess } from "./isNamespaceMemberAccess.js";

interface ISpecialImports {
  sideEffects: Set<string>;
  wholeNamespaces: Map<string, Set<string>>;
}

export async function findNativeSpecialImports(
  project: Project,
  targets: ReadonlySet<string>,
): Promise<ISpecialImports> {
  const sideEffects = new Set<string>();
  const wholeNamespaces = new Map<string, Set<string>>();
  for (const name of await getRelevantProgramFileNames(project)) {
    const source = await project.program.getSourceFile(name);
    if (!source) continue;
    const imports: ImportDeclaration[] = [];
    const visit = (node: Node): void => {
      if (isModuleDeclaration(node) || isModuleBlock(node)) node.forEachChild(visit);
      if (!isImportDeclaration(node)) return;
      const binding = node.importClause?.namedBindings;
      if (!node.importClause || (binding && isNamespaceImport(binding))) imports.push(node);
    };
    source.forEachChild(visit);
    if (!imports.length) continue;

    const symbols = await project.checker.getSymbolAtLocation(imports.map((node) => node.moduleSpecifier));
    for (const [index, node] of imports.entries()) {
      const target = await symbols[index]?.declarations[0]?.resolve();
      if (!target || !isSourceFile(target) || target === source || !targets.has(target.fileName)) continue;
      const binding = node.importClause?.namedBindings;
      if (!binding || !isNamespaceImport(binding)) {
        sideEffects.add(target.fileName);
        continue;
      }
      const references = await findNativeReferenceNodes(project, binding.name);
      if (references.some((reference) => reference !== binding.name && !isNamespaceMemberAccess(reference))) {
        const importers = wholeNamespaces.get(target.fileName) ?? new Set();
        importers.add(source.fileName);
        wholeNamespaces.set(target.fileName, importers);
      }
    }
  }
  return { sideEffects, wholeNamespaces };
}
