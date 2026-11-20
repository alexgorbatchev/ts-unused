import {
  isExportDeclaration,
  isImportDeclaration,
  isModuleBlock,
  isModuleDeclaration,
  isStringLiteral,
  type ExportDeclaration,
  type ImportDeclaration,
  type Node,
  type SourceFile,
} from "typescript/ast";
import type { Project } from "typescript/async";

export type ModuleStatement = ImportDeclaration | ExportDeclaration;

interface IModuleReference {
  source: SourceFile;
  statement: ModuleStatement;
}

export async function findModuleReferences(
  project: Project,
  targets: ReadonlySet<string>,
): Promise<Map<string, IModuleReference[]>> {
  const references = new Map<string, IModuleReference[]>();
  for (const name of await project.program.getSourceFileNames()) {
    const source = await project.program.getSourceFile(name);
    if (!source) continue;
    const statements: ModuleStatement[] = [];
    function collect(node: Node): void {
      if (isModuleDeclaration(node) || isModuleBlock(node)) {
        node.forEachChild(collect);
      } else if (isImportDeclaration(node) || isExportDeclaration(node)) {
        statements.push(node);
      }
    }
    source.forEachChild(collect);
    await Promise.all(
      statements.map(async (statement) => {
        const specifier = statement.moduleSpecifier;
        if (!specifier || !isStringLiteral(specifier)) return;
        const resolved = await project.program.getResolvedModuleFromModuleSpecifier(specifier, source.fileName);
        const target = resolved?.resolvedFileName;
        if (!target || !targets.has(target) || target === source.fileName) return;
        const existing = references.get(target);
        if (existing) existing.push({ source, statement });
        else references.set(target, [{ source, statement }]);
      }),
    );
  }
  return references;
}
