import { SEVERITY } from "./constants";
import path from "node:path";
import { SyntaxKind } from "ts-morph";
import type { SourceFile } from "ts-morph";
import { matchesPattern } from "./patternMatcher";
import { TypeComparison } from "./TypeComparison";
import type { IDuplicateTypeResult, ITypeLocation, TypeDeclaration } from "./types";

function getLocation(declaration: TypeDeclaration, tsConfigDir: string): ITypeLocation {
  const name = declaration.getNameNode();
  const character = name.getStart() - name.getStartLinePos() + 1;
  return {
    filePath: path.relative(tsConfigDir, declaration.getSourceFile().getFilePath()),
    typeName: declaration.getName(),
    line: name.getStartLineNumber(),
    character,
    endCharacter: character + name.getWidth(),
  };
}

function getBucketKey(declaration: TypeDeclaration): string {
  const type = declaration.getType();
  const category = type.isObject() || type.isIntersection() ? "object" : String(type.getFlags());
  return JSON.stringify([
    declaration.getTypeParameters().length,
    category,
    type
      .getProperties()
      .map((property) => property.getName())
      .sort(),
    type.getCallSignatures().length,
    type.getConstructSignatures().length,
  ]);
}

export function analyzeDuplicateTypes(
  sourceFiles: SourceFile[],
  tsConfigDir: string,
  ignoreTypes: string[] = [],
  targetFilePath?: string,
): IDuplicateTypeResult[] {
  const buckets = new Map<string, TypeDeclaration[][]>();
  const declarations: TypeDeclaration[] = sourceFiles.flatMap((file) => [
    ...file.getDescendantsOfKind(SyntaxKind.InterfaceDeclaration),
    ...file.getDescendantsOfKind(SyntaxKind.TypeAliasDeclaration),
  ]);
  declarations.sort((left, right) => {
    const leftPath = left.getSourceFile().getFilePath();
    const rightPath = right.getSourceFile().getFilePath();
    return leftPath.localeCompare(rightPath) || left.getStart() - right.getStart();
  });

  for (const declaration of declarations) {
    if (matchesPattern(declaration.getName(), ignoreTypes)) {
      continue;
    }
    const key = getBucketKey(declaration);
    const groups = buckets.get(key) ?? [];
    const group = groups.find((items) => {
      const first = items[0];
      return (
        first !== undefined &&
        new TypeComparison(declaration.getProject().getTypeChecker().compilerObject).compareDeclarations(
          first,
          declaration,
        )
      );
    });
    if (group) {
      group.push(declaration);
    } else {
      groups.push([declaration]);
      buckets.set(key, groups);
    }
  }

  const results: IDuplicateTypeResult[] = [];
  for (const groups of buckets.values()) {
    for (const group of groups) {
      for (const [index, declaration] of group.entries()) {
        if (targetFilePath ? declaration.getSourceFile().getFilePath() !== targetFilePath : index === 0) {
          continue;
        }
        const original = group.find((other) => other.getName() !== declaration.getName());
        if (original) {
          results.push({
            ...getLocation(declaration, tsConfigDir),
            duplicateOf: getLocation(original, tsConfigDir),
            severity: SEVERITY.ERROR,
          });
        }
      }
    }
  }
  return results;
}
