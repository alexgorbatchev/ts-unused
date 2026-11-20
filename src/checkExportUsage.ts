import { COMMENT_KIND, EXPORT_KIND, SEVERITY, USAGE_SOURCE } from "./constants.js";
import path from "node:path";
import {
  NodeFlags,
  isFunctionDeclaration,
  isClassDeclaration,
  isInterfaceDeclaration,
  isTypeAliasDeclaration,
  isEnumDeclaration,
  isModuleDeclaration,
  isVariableDeclaration,
  isVariableDeclarationList,
  isVariableStatement,
  isStringLiteral,
  type Node,
  type SourceFile,
} from "typescript/ast";
import { classifyExportReferences } from "./classifyExportReferences.js";
import { extractTodoComment, extractIgnoreComment } from "./extractTodoComment.js";
import { matchesPattern } from "./patternMatcher.js";
import type { ClassifyUsageSourceFn, ExportKind, Severity, IUnusedExportResult } from "./types.js";
import { isUsageSourceAtLeast } from "./usageSourceUtils.js";
import { getReferenceLocation } from "./findNativeReferenceNodes.js";

export interface ICheckExportOptions {
  ignoreExports?: string[];
  ignoreModuleAugmentations?: boolean;
  /** Declarations exported from package entry points in package mode */
  publicDeclarations?: Set<Node>;
  findReferences: (declaration: Node) => Node[] | Promise<Node[]>;
  wholeNamespaceImporters?: (file: SourceFile) => readonly string[];
}

function getExportKind(declaration: Node): ExportKind {
  if (isFunctionDeclaration(declaration)) {
    return EXPORT_KIND.FUNCTION;
  }
  if (isClassDeclaration(declaration)) {
    return EXPORT_KIND.CLASS;
  }
  if (isInterfaceDeclaration(declaration)) {
    return EXPORT_KIND.INTERFACE;
  }
  if (isTypeAliasDeclaration(declaration)) {
    return EXPORT_KIND.TYPE;
  }
  if (isEnumDeclaration(declaration)) {
    return EXPORT_KIND.ENUM;
  }
  if (isModuleDeclaration(declaration)) {
    return EXPORT_KIND.NAMESPACE;
  }
  if (isVariableDeclaration(declaration)) {
    const parent = declaration.parent;
    if (isVariableDeclarationList(parent)) {
      if (parent.flags & NodeFlags.Const) {
        return EXPORT_KIND.CONST;
      }
    }
    return EXPORT_KIND.VARIABLE;
  }
  return EXPORT_KIND.EXPORT;
}

/** Comments above `export const name = ...` belong to the variable statement, not its declaration. */
function getCommentNode(declaration: Node): Node {
  if (isVariableDeclaration(declaration)) {
    return isVariableStatement(declaration.parent.parent) ? declaration.parent.parent : declaration;
  }
  return declaration;
}

function getNameNode(declaration: Node): Node | undefined {
  if (
    isFunctionDeclaration(declaration) ||
    isClassDeclaration(declaration) ||
    isInterfaceDeclaration(declaration) ||
    isTypeAliasDeclaration(declaration) ||
    isEnumDeclaration(declaration) ||
    isVariableDeclaration(declaration)
  ) {
    return declaration.name;
  }
  return undefined;
}

/**
 * Checks if a declaration is a module augmentation (declare module "...").
 */
function isModuleAugmentation(declaration: Node): boolean {
  if (isModuleDeclaration(declaration)) {
    // Module augmentations have a string literal as name (e.g., "library-name")
    const nameNode = declaration.name;
    if (isStringLiteral(nameNode)) {
      return true;
    }
  }
  return false;
}

export async function checkExportUsage(
  exportName: string,
  declarations: readonly Node[],
  sourceFile: SourceFile,
  tsConfigDir: string,
  classifyUsageSource: ClassifyUsageSourceFn,
  options: ICheckExportOptions,
): Promise<IUnusedExportResult | null> {
  const {
    ignoreExports = [],
    ignoreModuleAugmentations = true,
    publicDeclarations,
    findReferences,
    wholeNamespaceImporters,
  } = options;

  const firstDeclaration: Node | undefined = declarations[0];
  if (!firstDeclaration) {
    return null;
  }

  // Check if export should be ignored
  if (ignoreExports.length > 0 && matchesPattern(exportName, ignoreExports)) {
    return null;
  }

  const relativePath: string = path.relative(tsConfigDir, sourceFile.fileName);

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
  if (declarationSourceFile.fileName !== sourceFile.fileName) {
    return null;
  }

  if (!getReferenceLocation(firstDeclaration)) {
    return null;
  }

  // Count usages by file type; export and import specifiers only name the export, and a namespace import used as a
  // whole value counts once for every export of the module. Usage from files at least as close to production as the
  // declaring file keeps the export alive: stories keep story-file exports alive, but not production exports.
  const declarationSource = classifyUsageSource(sourceFile.fileName);
  let liveReferences = 0;
  let storyReferences = 0;
  let testReferences = 0;

  const usageFiles = [
    ...classifyExportReferences(await findReferences(firstDeclaration)).usages.map(
      (reference) => reference.getSourceFile().fileName,
    ),
    ...(wholeNamespaceImporters?.(sourceFile) ?? []),
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
  const character = sourceFile.getLineAndCharacterOfPosition(positionNode.getStart(sourceFile)).character + 1;
  const endCharacter: number = character + exportName.length;

  const result: IUnusedExportResult = {
    filePath: relativePath,
    exportName,
    line: sourceFile.getLineAndCharacterOfPosition(firstDeclaration.getStart(sourceFile)).line + 1,
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
