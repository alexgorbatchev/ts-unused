import { COMMENT_KIND, EXPORT_KIND, SEVERITY, USAGE_SOURCE } from "./constants.js";
import path from "node:path";
import { Node, type SourceFile, VariableDeclarationKind } from "ts-morph";
import { classifyExportReferences } from "./classifyExportReferences.js";
import { extractTodoComment, extractIgnoreComment } from "./extractTodoComment.js";
import { getWholeNamespaceImporters } from "./getWholeNamespaceImporters.js";
import { matchesPattern } from "./patternMatcher.js";
import type { ClassifyUsageSourceFn, ExportKind, Severity, IUnusedExportResult } from "./types.js";
import { isUsageSourceAtLeast } from "./usageSourceUtils.js";

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

/** Comments above `export const name = ...` belong to the variable statement, not its declaration. */
function getCommentNode(declaration: Node): Node {
  if (Node.isVariableDeclaration(declaration)) {
    return declaration.getVariableStatement() ?? declaration;
  }
  return declaration;
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
  classifyUsageSource: ClassifyUsageSourceFn,
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

  // Count usages by file type; export and import specifiers only name the export, and a namespace import used as a
  // whole value counts once for every export of the module. Usage from files at least as close to production as the
  // declaring file keeps the export alive: stories keep story-file exports alive, but not production exports.
  const declarationSource = classifyUsageSource(sourceFile);
  let liveReferences = 0;
  let storyReferences = 0;
  let testReferences = 0;

  const usageFiles = [
    ...classifyExportReferences(firstDeclaration).usages.map((reference) => reference.getSourceFile()),
    ...getWholeNamespaceImporters(sourceFile),
  ];
  for (const usageFile of usageFiles) {
    const usageSource = classifyUsageSource(usageFile);
    if (isUsageSourceAtLeast(usageSource, declarationSource)) {
      liveReferences++;
    } else if (usageSource === USAGE_SOURCE.STORY) {
      storyReferences++;
    } else {
      testReferences++;
    }
  }

  // An export is unused if its only live usage is the definition itself
  const onlyUsedOutsideLiveCode: boolean = liveReferences === 1 && storyReferences + testReferences > 0;
  const onlyUsedInStories: boolean = onlyUsedOutsideLiveCode && storyReferences > 0;
  const onlyUsedInTests: boolean = onlyUsedOutsideLiveCode && !onlyUsedInStories;

  if (liveReferences + storyReferences + testReferences > 1 && !onlyUsedOutsideLiveCode) {
    return null; // Used by production code, or by stories for an export of a story file
  }

  const kind: ExportKind = getExportKind(firstDeclaration);

  const commentNode = getCommentNode(firstDeclaration);
  const ignoreComment = extractIgnoreComment(commentNode);
  const todoComment = ignoreComment ? `[ts-unused-ignore] ${ignoreComment}` : extractTodoComment(commentNode);

  // Determine severity: warning for TODO/ignore, info for test-only and story-only, error for completely unused
  let severity: Severity = SEVERITY.ERROR;
  if (todoComment) {
    severity = SEVERITY.WARNING;
  } else if (onlyUsedOutsideLiveCode) {
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
    onlyUsedInStories,
  };
  return result;
}
