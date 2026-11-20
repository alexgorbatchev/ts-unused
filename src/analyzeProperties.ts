import path from "node:path";
import {
  isInterfaceDeclaration,
  isTypeAliasDeclaration,
  isTypeLiteralNode,
  isPropertySignatureDeclaration,
  type SourceFile,
} from "typescript/ast";
import { COMMENT_KIND, SEVERITY } from "./constants.js";
import { extractIgnoreComment, extractTodoComment } from "./extractTodoComment.js";
import { matchesPattern } from "./patternMatcher.js";
import type { IAnalyzePropertiesOptions, IUnusedPropertyResult } from "./types.js";

export async function analyzeProperties(
  sourceFile: SourceFile,
  tsConfigDir: string,
  results: IUnusedPropertyResult[],
  options: IAnalyzePropertiesOptions,
): Promise<void> {
  const { ignoreProperties = [], ignoreTypes = [], publicApiDeclarations, propertyUsage } = options;
  const declarations = [
    ...sourceFile.statements.filter(isInterfaceDeclaration),
    ...sourceFile.statements.filter(isTypeAliasDeclaration),
  ];
  const filePath = path.relative(tsConfigDir, sourceFile.fileName);
  for (const declaration of declarations) {
    const typeName = declaration.name.text;
    if (matchesPattern(typeName, ignoreTypes) || publicApiDeclarations?.has(declaration)) continue;
    const shape = isInterfaceDeclaration(declaration) ? declaration : declaration.type;
    if (!isInterfaceDeclaration(shape) && !isTypeLiteralNode(shape)) continue;

    for (const member of shape.members) {
      if (!isPropertySignatureDeclaration(member)) continue;
      const propertyName = member.name.getText(sourceFile);
      if (matchesPattern(propertyName, ignoreProperties)) continue;
      const usage = await propertyUsage(member);
      if (!usage.isUnusedOrTestOnly) continue;

      const ignoreComment = extractIgnoreComment(member);
      const todoComment = ignoreComment ? `[ts-unused-ignore] ${ignoreComment}` : extractTodoComment(member);
      const position = sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile));
      const character = position.character + 1;
      const severity = todoComment
        ? SEVERITY.WARNING
        : usage.onlyUsedInTests || usage.onlyUsedInStories
          ? SEVERITY.INFO
          : SEVERITY.ERROR;
      results.push({
        filePath,
        typeName,
        propertyName,
        line: position.line + 1,
        character,
        endCharacter: character + propertyName.length,
        severity,
        todoComment,
        commentKind: ignoreComment ? COMMENT_KIND.IGNORE : todoComment ? COMMENT_KIND.TODO : undefined,
        onlyUsedInTests: usage.onlyUsedInTests,
        onlyUsedInStories: usage.onlyUsedInStories,
      });
    }
  }
}
