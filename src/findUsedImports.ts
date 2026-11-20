import { type Project, ts } from "ts-morph";
import { USAGE_SOURCE } from "./constants.js";
import type { ClassifyUsageSourceFn } from "./types.js";

type ImportBinding = ts.ImportSpecifier | ts.ImportClause;

/** An actual use of an imported binding in production proves its export is live. */
export function findUsedImports(project: Project, classify: ClassifyUsageSourceFn): Set<ts.Node> {
  const used = new Set<ts.Node>();
  const program = project.getProgram().compilerObject;
  const checker = program.getTypeChecker();
  for (const file of project.getSourceFiles()) {
    if (file.isDeclarationFile() || classify(file) !== USAGE_SOURCE.PRODUCTION) {
      continue;
    }
    const source = program.getSourceFile(file.getFilePath());
    if (!source) continue;
    const bindings = new Map<string, ImportBinding>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
      const clause = statement.importClause;
      if (clause.name) bindings.set(clause.name.text, clause);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const specifier of clause.namedBindings.elements) bindings.set(specifier.name.text, specifier);
      }
    }
    const visit = (node: ts.Node): void => {
      if (!bindings.size || ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
      if (ts.isIdentifier(node)) {
        const binding = bindings.get(node.text);
        if (!binding || (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) return;
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias && symbol.declarations?.includes(binding)) {
          for (const declaration of checker.getAliasedSymbol(symbol).declarations ?? []) used.add(declaration);
          bindings.delete(node.text);
        }
      } else {
        ts.forEachChild(node, visit);
      }
    };
    ts.forEachChild(source, visit);
  }
  return used;
}
