import path from "node:path";
import { Node, type SourceFile } from "ts-morph";
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
  const declarations = [...sourceFile.getInterfaces(), ...sourceFile.getTypeAliases()];
  const filePath = path.relative(tsConfigDir, sourceFile.getFilePath());
  for (const declaration of declarations) {
    const typeName = declaration.getName();
    if (matchesPattern(typeName, ignoreTypes) || publicApiDeclarations?.has(declaration)) continue;
    const shape = Node.isInterfaceDeclaration(declaration) ? declaration : declaration.getTypeNode();
    if (!Node.isInterfaceDeclaration(shape) && !Node.isTypeLiteral(shape)) continue;

    for (const member of shape.getMembers()) {
      if (!Node.isPropertySignature(member)) continue;
      const propertyName = member.getName();
      if (matchesPattern(propertyName, ignoreProperties)) continue;
      const usage = await propertyUsage(member);
      if (!usage.isUnusedOrTestOnly) continue;

      const ignoreComment = extractIgnoreComment(member);
      const todoComment = ignoreComment ? `[ts-unused-ignore] ${ignoreComment}` : extractTodoComment(member);
      const character = member.getStart() - member.getStartLinePos() + 1;
      const severity = todoComment
        ? SEVERITY.WARNING
        : usage.onlyUsedInTests || usage.onlyUsedInStories
          ? SEVERITY.INFO
          : SEVERITY.ERROR;
      results.push({
        filePath,
        typeName,
        propertyName,
        line: member.getStartLineNumber(),
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
