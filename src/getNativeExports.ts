import { isExportAssignment, isFunctionDeclaration, isIdentifier, type Node, type SourceFile } from "typescript/ast";
import { type Project, type Symbol, SymbolFlags, type NodeHandle } from "typescript/async";

export async function resolveNativeExport(project: Project, symbol: Symbol): Promise<readonly NodeHandle[]> {
  const resolved = symbol.flags & SymbolFlags.Alias ? await project.checker.getAliasedSymbol(symbol) : symbol;
  return resolved.declarations;
}

export async function getNativeExports(project: Project, sourceFile: SourceFile): Promise<Map<string, Node[]>> {
  const module = await project.checker.getSymbolOfSourceFile(sourceFile.fileName);
  if (!module) return new Map();

  const exports = await project.checker.getExportsOfModule(module);
  const entries = await Promise.all(
    exports.map(async (symbol) => {
      const handles = await resolveNativeExport(project, symbol);
      const nativeDeclarations = await Promise.all(handles.map((handle) => handle.resolve()));
      const hoisted =
        !(symbol.flags & SymbolFlags.Alias) &&
        nativeDeclarations.some(
          (declaration) =>
            declaration &&
            isFunctionDeclaration(declaration) &&
            String(declaration.getSourceFile().fileName) === sourceFile.fileName,
        );
      const declarations = nativeDeclarations.flatMap((node) =>
        node ? [isExportAssignment(node) && !isIdentifier(node.expression) ? node.expression : node] : [],
      );
      return { name: symbol.name, declarations, hoisted };
    }),
  );
  // Preserve the declaration ordering of the previous binder, which visited functions first.
  entries.sort((left, right) => Number(right.hoisted) - Number(left.hoisted));
  return new Map(entries.map(({ name, declarations }) => [name, declarations]));
}
