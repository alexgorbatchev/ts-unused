import { COMMENT_KIND, EXPORT_KIND, SEVERITY } from "./constants.js";
import path from "node:path";
import { Node, type SourceFile, VariableDeclarationKind } from "ts-morph";
import { classifyExportReferences } from "./classifyExportReferences.js";
import { extractTodoComment, extractIgnoreComment } from "./extractTodoComment.js";
import { matchesPattern } from "./patternMatcher.js";
import type { ExportKind, IsTestFileFn, Severity, IUnusedExportResult } from "./types.js";

export interface ICheckExportOptions {
  ignoreExports?: string[];
  ignoreModuleAugmentations?: boolean;
  /** Declarations exported from package entry points in package mode */
  publicDeclarations?: Set<Node>;
}

function getExportKind(declaration: Node): ExportKind {
  if (Node.isFunctionDeclaration(declaration)) {
    return EXPORT_KIND.FUNCTION;
  }
  if (Node.isClassDeclaration(declaration)) {
    return EXPORT_KIND.CLASS;
  }
  if (Node.isInterfaceDeclaration(declaration)) {
    return EXPORT_KIND.INTERFACE;
  }
  if (Node.isTypeAliasDeclaration(declaration)) {
    return EXPORT_KIND.TYPE;
  }
  if (Node.isEnumDeclaration(declaration)) {
    return EXPORT_KIND.ENUM;
  }
  if (Node.isModuleDeclaration(declaration)) {
    return EXPORT_KIND.NAMESPACE;
  }
  if (Node.isVariableDeclaration(declaration)) {
    const parent = declaration.getParent();
    if (Node.isVariableDeclarationList(parent)) {
      const declarationKind = parent.getDeclarationKind();
      if (declarationKind === VariableDeclarationKind.Const) {
        return EXPORT_KIND.CONST;
      }
    }
    return EXPORT_KIND.VARIABLE;
  }
  return EXPORT_KIND.EXPORT;
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

export function checkExportUsage(
  exportName: string,
  declarations: readonly Node[],
  sourceFile: SourceFile,
  tsConfigDir: string,
  isTestFile: IsTestFileFn,
  options: ICheckExportOptions = {},
): IUnusedExportResult | null {
  const { ignoreExports = [], ignoreModuleAugmentations = true, publicDeclarations } = options;

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
  if (publicDeclarations && declarations.some((declaration) => publicDeclarations.has(declaration))) {
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

  // Count usages by file type; re-exports and imports that only feed them are forwarding, not usage
  let testReferences = 0;
  let nonTestReferences = 0;

  for (const reference of classifyExportReferences(firstDeclaration).usages) {
    if (isTestFile(reference.getSourceFile())) {
      testReferences++;
    } else {
      nonTestReferences++;
    }
  }

  // An export is unused if its only usage is the definition itself
  const onlyUsedInTests: boolean = nonTestReferences === 1 && testReferences > 0;

  if (nonTestReferences + testReferences > 1 && !onlyUsedInTests) {
    return null; // Used in production code
  }

  const kind: ExportKind = getExportKind(firstDeclaration);

  const ignoreComment = extractIgnoreComment(firstDeclaration);
  const todoComment = ignoreComment ? `[ts-unused-ignore] ${ignoreComment}` : extractTodoComment(firstDeclaration);

  // Determine severity: warning for TODO/ignore, info for test-only, error for completely unused
  let severity: Severity = SEVERITY.ERROR;
  if (todoComment) {
    severity = SEVERITY.WARNING;
  } else if (onlyUsedInTests) {
    severity = SEVERITY.INFO;
  }

  // Get the name node for accurate position highlighting
  const nameNode: Node | undefined = getNameNode(firstDeclaration);
  const positionNode: Node = nameNode || firstDeclaration;
  const startPos: number = positionNode.getStart();
  const lineStartPos: number = positionNode.getStartLinePos();
  const character: number = startPos - lineStartPos + 1;
  const endCharacter: number = character + exportName.length;

  const result: IUnusedExportResult = {
    filePath: relativePath,
    exportName,
    line: firstDeclaration.getStartLineNumber(),
    character,
    endCharacter,
    kind,
    todoComment,
    commentKind: ignoreComment ? COMMENT_KIND.IGNORE : todoComment ? COMMENT_KIND.TODO : undefined,
    severity,
    onlyUsedInTests,
  };
  return result;
}
