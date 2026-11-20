import {
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isExportDeclaration,
  isPropertyAccessExpression,
  type Identifier,
  type Node,
} from "typescript/ast";
import { type Project, SymbolFlags } from "typescript/async";
import type { SourceFile } from "ts-morph";
import { USAGE_SOURCE } from "./constants.js";
import type { ClassifyUsageSourceFn } from "./types.js";
import { resolveNativeExport } from "./getNativeExports.js";

export function declarationLocation(file: string, start: number): string {
  return `${file}:${start}`;
}

/** Finds original export declarations reached through live named or default imports. */
export async function findNativeUsedImports(
  project: Project,
  files: readonly SourceFile[],
  classify: ClassifyUsageSourceFn,
): Promise<Set<string>> {
  const used = new Set<string>();
  for (const file of files) {
    if (file.isDeclarationFile() || classify(file) !== USAGE_SOURCE.PRODUCTION) continue;
    const source = await project.program.getSourceFile(file.getFilePath());
    if (!source) continue;

    const bindings = new Map<string, Identifier>();
    for (const statement of source.statements) {
      if (!isImportDeclaration(statement) || !statement.importClause) continue;
      const clause = statement.importClause;
      if (clause.name) bindings.set(clause.name.text, clause.name);
      if (clause.namedBindings && isNamedImports(clause.namedBindings)) {
        for (const specifier of clause.namedBindings.elements) {
          bindings.set(specifier.name.text, specifier.name);
        }
      }
    }
    if (!bindings.size) continue;

    const candidates: Identifier[] = [];
    const visit = (node: Node): void => {
      if (isImportDeclaration(node) || isExportDeclaration(node)) return;
      if (isIdentifier(node)) {
        const parent = node.parent;
        if (bindings.has(node.text) && !(isPropertyAccessExpression(parent) && parent.name === node)) {
          candidates.push(node);
        }
      } else {
        node.forEachChild(visit);
      }
    };
    source.forEachChild(visit);
    if (!candidates.length) continue;

    const [bindingSymbols, usages] = await Promise.all([
      project.checker.getSymbolAtLocation([...bindings.values()]),
      project.checker.getSymbolAtLocation(candidates),
    ]);
    const local = new Set(bindingSymbols.flatMap((symbol) => (symbol ? [symbol.id] : [])));
    const symbols = new Map(
      usages.flatMap((symbol) =>
        symbol && symbol.flags & SymbolFlags.Alias && local.has(symbol.id) ? [[symbol.id, symbol] as const] : [],
      ),
    );
    await Promise.all(
      [...symbols.values()].map(async (symbol) => {
        const targets = await resolveNativeExport(project, symbol);
        for (const target of targets) {
          const declaration = await target.resolve();
          if (declaration) used.add(declarationLocation(declaration.getSourceFile().fileName, declaration.getStart()));
        }
      }),
    );
  }
  return used;
}
