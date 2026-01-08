import path from "node:path";
import { Node, type ReferenceEntry, type ReferencedSymbol, type SourceFile, SyntaxKind } from "ts-morph";
import { matchesPattern } from "./patternMatcher";
import { isPublicExport } from "./tracePublicExports";
import type { ExportKind, IsTestFileFn, Severity, UnusedExportResult } from "./types";

export interface CheckExportOptions {
  ignoreExports?: string[];
  ignoreModuleAugmentations?: boolean;
  /** Set of public exports in package mode (format: "relativePath::exportName") */
  publicExports?: Set<string>;
}

function getExportKind(declaration: Node): ExportKind {
  if (Node.isFunctionDeclaration(declaration)) {
    return "function";
  }
  if (Node.isClassDeclaration(declaration)) {
    return "class";
  }
  if (Node.isInterfaceDeclaration(declaration)) {
    return "interface";
  }
  if (Node.isTypeAliasDeclaration(declaration)) {
    return "type";
  }
  if (Node.isEnumDeclaration(declaration)) {
    return "enum";
  }
  if (Node.isModuleDeclaration(declaration)) {
    return "namespace";
  }
  if (Node.isVariableDeclaration(declaration)) {
    const parent = declaration.getParent();
    if (Node.isVariableDeclarationList(parent)) {
      const declarationKind = parent.getDeclarationKind();
      if (declarationKind === "const") {
        return "const";
      }
    }
    return "variable";
  }
  return "export";
}

function getNameNode(declaration: Node): Node | undefined {
  if (
    Node.isFunctionDeclaration(declaration) ||
    Node.isClassDeclaration(declaration) ||
    Node.isInterfaceDeclaration(declaration) ||
    Node.isTypeAliasDeclaration(declaration) ||
    Node.isEnumDeclaration(declaration) ||
    Node.isVariableDeclaration(declaration)
  ) {
    return declaration.getNameNode();
  }
  return undefined;
}

/**
 * Checks if a declaration is a module augmentation (declare module "...").
 */
function isModuleAugmentation(declaration: Node): boolean {
  if (Node.isModuleDeclaration(declaration)) {
    // Module augmentations have a string literal as name (e.g., "library-name")
    const nameNode = declaration.getNameNode();
    if (Node.isStringLiteral(nameNode)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a reference is a re-export (export { X } from './module' or export { X }).
 * Re-exports should not count as actual usage since they're just forwarding the export.
 */
function isReExport(ref: ReferenceEntry): boolean {
  const node = ref.getNode();
  let current: Node | undefined = node;

  // Walk up the AST to check if this reference is part of an export declaration
  while (current) {
    const kind = current.getKind();

    // Check for named export: export { X } from './module' or export { X }
    if (kind === SyntaxKind.ExportSpecifier) {
      return true;
    }

    // Check for export declaration that contains this reference
    if (kind === SyntaxKind.ExportDeclaration) {
      return true;
    }

    // Stop at statement boundaries to avoid false positives
    if (
      kind === SyntaxKind.VariableStatement ||
      kind === SyntaxKind.FunctionDeclaration ||
      kind === SyntaxKind.ClassDeclaration ||
      kind === SyntaxKind.ExpressionStatement ||
      kind === SyntaxKind.Block
    ) {
      break;
    }

    current = current.getParent();
  }

  return false;
}

export function checkExportUsage(
  exportName: string,
  declarations: readonly Node[],
  sourceFile: SourceFile,
  tsConfigDir: string,
  isTestFile: IsTestFileFn,
  options: CheckExportOptions = {}
): UnusedExportResult | null {
  const { ignoreExports = [], ignoreModuleAugmentations = true, publicExports } = options;

  const firstDeclaration: Node | undefined = declarations[0];
  if (!firstDeclaration) {
    return null;
  }

  // Check if export should be ignored
  if (ignoreExports.length > 0 && matchesPattern(exportName, ignoreExports)) {
    return null;
  }

  const relativePath: string = path.relative(tsConfigDir, sourceFile.getFilePath());

  // In package mode, check if this export is part of the public API
  if (publicExports && isPublicExport(publicExports, relativePath, exportName)) {
    return null;
  }

  // Check if this is a module augmentation that should be ignored
  if (ignoreModuleAugmentations && isModuleAugmentation(firstDeclaration)) {
    return null;
  }

  // Only report symbols defined in this file, not re-exports
  const declarationSourceFile: SourceFile = firstDeclaration.getSourceFile();
  if (declarationSourceFile.getFilePath() !== sourceFile.getFilePath()) {
    return null;
  }

  if (!Node.isReferenceFindable(firstDeclaration)) {
    return null;
  }

  const references: ReferencedSymbol[] = firstDeclaration.findReferences();

  // Count references by type, excluding re-exports which are just forwarding the symbol
  let totalReferences = 0;
  let testReferences = 0;
  let nonTestReferences = 0;

  for (const refGroup of references) {
    const refs = refGroup.getReferences();
    for (const ref of refs) {
      const refSourceFile: SourceFile = ref.getSourceFile();
      totalReferences++;

      // Check if this reference is a re-export (shouldn't count as actual usage)
      if (isReExport(ref)) {
        continue;
      }

      if (isTestFile(refSourceFile)) {
        testReferences++;
      } else {
        nonTestReferences++;
      }
    }
  }

  // An export is unused if it only has 1 non-reexport reference (the definition itself)
  // Re-exports don't count as actual usage since they just forward the symbol
  const onlyUsedInTests: boolean = nonTestReferences === 1 && testReferences > 0;

  if (totalReferences > 1 && !onlyUsedInTests) {
    return null; // Used in production code
  }

  const kind: ExportKind = getExportKind(firstDeclaration);

  // Determine severity: info for test-only, error for completely unused
  const severity: Severity = onlyUsedInTests ? "info" : "error";

  // Get the name node for accurate position highlighting
  const nameNode: Node | undefined = getNameNode(firstDeclaration);
  const positionNode: Node = nameNode || firstDeclaration;
  const startPos: number = positionNode.getStart();
  const lineStartPos: number = positionNode.getStartLinePos();
  const character: number = startPos - lineStartPos + 1;
  const endCharacter: number = character + exportName.length;

  const result: UnusedExportResult = {
    filePath: relativePath,
    exportName,
    line: firstDeclaration.getStartLineNumber(),
    character,
    endCharacter,
    kind,
    severity,
    onlyUsedInTests,
  };
  return result;
}
