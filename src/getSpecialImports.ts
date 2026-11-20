import { ts, type SourceFile } from "ts-morph";

interface ISpecialImports {
  namespaces: ts.Identifier[];
  sideEffect: boolean;
}

const cache = new WeakMap<ts.Program, Map<string, ISpecialImports>>();

/** Only namespace and side-effect imports can keep an entire module alive. */
export function getSpecialImports(file: SourceFile): ISpecialImports | undefined {
  const program = file.getProject().getProgram().compilerObject;
  const cached = cache.get(program);
  if (cached) return cached.get(file.getFilePath());
  const imports = new Map<string, ISpecialImports>();
  const checker = program.getTypeChecker();
  const visit = (node: ts.Node): void => {
    if (ts.isModuleDeclaration(node) || ts.isModuleBlock(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    if (!ts.isImportDeclaration(node)) return;
    const binding = node.importClause?.namedBindings;
    if (node.importClause && (!binding || !ts.isNamespaceImport(binding))) return;
    const target = checker.getSymbolAtLocation(node.moduleSpecifier)?.declarations?.[0];
    if (!target || !ts.isSourceFile(target) || target.fileName === node.getSourceFile().fileName) return;
    const entry = imports.get(target.fileName) ?? { namespaces: [], sideEffect: false };
    if (binding && ts.isNamespaceImport(binding)) entry.namespaces.push(binding.name);
    else entry.sideEffect = true;
    imports.set(target.fileName, entry);
  };
  for (const source of program.getSourceFiles()) ts.forEachChild(source, visit);
  cache.set(program, imports);
  return imports.get(file.getFilePath());
}
