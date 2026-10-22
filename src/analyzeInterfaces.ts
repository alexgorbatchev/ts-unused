import { COMMENT_KIND, SEVERITY } from "./constants.js";
import path from "node:path";
import type { InterfaceDeclaration, Project, SourceFile } from "ts-morph";
import { extractTodoComment, extractIgnoreComment } from "./extractTodoComment.js";
import { isPropertyUnused, type IPropertyUsageResult } from "./isPropertyUnused.js";
import { matchesPattern } from "./patternMatcher.js";
import type { ClassifyUsageSourceFn, IAnalyzePropertiesOptions, Severity, IUnusedPropertyResult } from "./types.js";

export function analyzeInterfaces(
  sourceFile: SourceFile,
  tsConfigDir: string,
  classifyUsageSource: ClassifyUsageSourceFn,
  results: IUnusedPropertyResult[],
  project: Project,
  options: IAnalyzePropertiesOptions = {},
): void {
  const { ignoreProperties = [], ignoreTypes = [], publicApiDeclarations } = options;
  const interfaces: InterfaceDeclaration[] = sourceFile.getInterfaces();

  for (const iface of interfaces) {
    const interfaceName: string = iface.getName();

    // Skip ignored types
    if (ignoreTypes.length > 0 && matchesPattern(interfaceName, ignoreTypes)) {
      continue;
    }

    // In package mode, consumers read and write the properties of public API types
    if (publicApiDeclarations?.has(iface)) {
      continue;
    }

    for (const prop of iface.getProperties()) {
      const propertyName: string = prop.getName();

      // Skip ignored properties
      if (ignoreProperties.length > 0 && matchesPattern(propertyName, ignoreProperties)) {
        continue;
      }

      const usage: IPropertyUsageResult = isPropertyUnused(prop, classifyUsageSource, project);

      if (usage.isUnusedOrTestOnly) {
        const relativePath: string = path.relative(tsConfigDir, sourceFile.getFilePath());
        const ignoreComment = extractIgnoreComment(prop);
        const todoComment: string | undefined = ignoreComment
          ? `[ts-unused-ignore] ${ignoreComment}`
          : extractTodoComment(prop);

        // Determine severity: warning for TODO/ignore, info for test-only and story-only, error for completely unused
        let severity: Severity = SEVERITY.ERROR;
        if (todoComment) {
          severity = SEVERITY.WARNING;
        } else if (usage.onlyUsedInTests || usage.onlyUsedInStories) {
          severity = SEVERITY.INFO;
        }

        const startPos: number = prop.getStart();
        const lineStartPos: number = prop.getStartLinePos();
        const character: number = startPos - lineStartPos + 1;
        const endCharacter: number = character + propertyName.length;
        const result: IUnusedPropertyResult = {
          filePath: relativePath,
          typeName: interfaceName,
          propertyName,
          line: prop.getStartLineNumber(),
          character,
          endCharacter,
          todoComment,
          commentKind: ignoreComment ? COMMENT_KIND.IGNORE : todoComment ? COMMENT_KIND.TODO : undefined,
          severity,
          onlyUsedInTests: usage.onlyUsedInTests,
          onlyUsedInStories: usage.onlyUsedInStories,
        };
        results.push(result);
      }
    }
  }
}
