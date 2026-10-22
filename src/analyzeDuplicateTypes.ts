import { SEVERITY } from "./constants.js";
import path from "node:path";
import { Node, SyntaxKind } from "ts-morph";
import type { SourceFile } from "ts-morph";
import { matchesPattern } from "./patternMatcher.js";
import { TypeComparison } from "./TypeComparison.js";
import { isDerivedTypeDeclaration } from "./isDerivedTypeDeclaration.js";
import type { IDuplicateTypeResult, ITypeLocation, TypeDeclaration } from "./types.js";

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

function referencesDefinition(
  declaration: TypeDeclaration,
  definition: TypeDeclaration,
  visited = new Set<TypeDeclaration>(),
): boolean {
  if (visited.has(declaration)) {
    return false;
  }
  visited.add(declaration);
  const references = [
    ...declaration.getDescendantsOfKind(SyntaxKind.TypeReference).map((node) => node.getTypeName()),
    ...(Node.isInterfaceDeclaration(declaration) ? declaration.getExtends().map((node) => node.getExpression()) : []),
  ];
  return references.some((node) => {
    const symbol = node.getSymbol();
    const declarations = (symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol)?.getDeclarations() ?? [];
    return declarations.some(
      (source) =>
        source === definition ||
        ((Node.isTypeAliasDeclaration(source) || Node.isInterfaceDeclaration(source)) &&
          referencesDefinition(source, definition, visited)),
    );
  });
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
  const derived = new Set(declarations.filter(isDerivedTypeDeclaration));
  for (const groups of buckets.values()) {
    for (const group of groups) {
      // A preceding alias must not turn its own source definition into a duplicate.
      const definitions = group.filter((declaration) => !derived.has(declaration));
      const sources = group.filter((declaration) => {
        const type = declaration.getType();
        return (
          !derived.has(declaration) ||
          !definitions.some((definition) => {
            const other = definition.getType();
            return (
              type.compilerType === other.compilerType ||
              (type.getSymbol() !== undefined && type.getSymbol() === other.getSymbol()) ||
              referencesDefinition(declaration, definition)
            );
          })
        );
      });
      for (const [index, declaration] of sources.entries()) {
        if (
          derived.has(declaration) ||
          (targetFilePath ? declaration.getSourceFile().getFilePath() !== targetFilePath : index === 0)
        ) {
          continue;
        }
        const original = sources.find((other) => other.getName() !== declaration.getName());
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
