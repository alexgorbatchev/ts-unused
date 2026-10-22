import { COMMENT_KIND, SEVERITY } from "./constants.js";
import path from "node:path";
import { Node, type Project, type SourceFile, type TypeAliasDeclaration, type TypeElementTypes } from "ts-morph";
import { extractTodoComment, extractIgnoreComment } from "./extractTodoComment.js";
import { isPropertyUnused, type IPropertyUsageResult } from "./isPropertyUnused.js";
import { matchesPattern } from "./patternMatcher.js";
import type { IAnalyzePropertiesOptions, IsTestFileFn, Severity, IUnusedPropertyResult } from "./types.js";

export function analyzeTypeLiteralMember(
  member: TypeElementTypes,
  typeName: string,
  sourceFile: SourceFile,
  tsConfigDir: string,
  isTestFile: IsTestFileFn,
  results: IUnusedPropertyResult[],
  project: Project,
  options: IAnalyzePropertiesOptions = {},
): void {
  const { ignoreProperties = [] } = options;

  if (!Node.isPropertySignature(member)) {
    return;
  }

  const propertyName: string = member.getName();

  // Skip ignored properties
  if (ignoreProperties.length > 0 && matchesPattern(propertyName, ignoreProperties)) {
    return;
  }

  const usage: IPropertyUsageResult = isPropertyUnused(member, isTestFile, project);

  if (!usage.isUnusedOrTestOnly) {
    return;
  }

  const relativePath: string = path.relative(tsConfigDir, sourceFile.getFilePath());
  const ignoreComment = extractIgnoreComment(member);
  const todoComment: string | undefined = ignoreComment
    ? `[ts-unused-ignore] ${ignoreComment}`
    : extractTodoComment(member);

  // Determine severity: warning for TODO/ignore, info for test-only, error for completely unused
  let severity: Severity = SEVERITY.ERROR;
  if (todoComment) {
    severity = SEVERITY.WARNING;
  } else if (usage.onlyUsedInTests) {
    severity = SEVERITY.INFO;
  }

  const startPos: number = member.getStart();
  const lineStartPos: number = member.getStartLinePos();
  const character: number = startPos - lineStartPos + 1;
  const endCharacter: number = character + propertyName.length;
  const result: IUnusedPropertyResult = {
    filePath: relativePath,
    typeName,
    propertyName,
    line: member.getStartLineNumber(),
    character,
    endCharacter,
    todoComment,
    commentKind: ignoreComment ? COMMENT_KIND.IGNORE : todoComment ? COMMENT_KIND.TODO : undefined,
    severity,
    onlyUsedInTests: usage.onlyUsedInTests,
  };
  results.push(result);
}

export function analyzeTypeAlias(
  typeAlias: TypeAliasDeclaration,
  sourceFile: SourceFile,
  tsConfigDir: string,
  isTestFile: IsTestFileFn,
  results: IUnusedPropertyResult[],
  project: Project,
  options: IAnalyzePropertiesOptions = {},
): void {
  const { ignoreTypes = [] } = options;
  const typeName: string = typeAlias.getName();

  // Skip ignored types
  if (ignoreTypes.length > 0 && matchesPattern(typeName, ignoreTypes)) {
    return;
  }

  const typeNode = typeAlias.getTypeNode();

  if (!typeNode) {
    return;
  }

  if (!Node.isTypeLiteral(typeNode)) {
    return;
  }

  for (const member of typeNode.getMembers()) {
    analyzeTypeLiteralMember(member, typeName, sourceFile, tsConfigDir, isTestFile, results, project, options);
  }
}

export function analyzeTypeAliases(
  sourceFile: SourceFile,
  tsConfigDir: string,
  isTestFile: IsTestFileFn,
  results: IUnusedPropertyResult[],
  project: Project,
  options: IAnalyzePropertiesOptions = {},
): void {
  const typeAliases: TypeAliasDeclaration[] = sourceFile.getTypeAliases();

  for (const typeAlias of typeAliases) {
    analyzeTypeAlias(typeAlias, sourceFile, tsConfigDir, isTestFile, results, project, options);
  }
}
