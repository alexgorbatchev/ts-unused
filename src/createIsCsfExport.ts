import { Node, type ObjectLiteralExpression, type SourceFile } from "ts-morph";

/** Whether an export of a story file is read by Storybook. */
export type IsCsfExportFn = (exportName: string, declarations: readonly Node[]) => boolean;

/** Export names in an array match exactly; a regex (or a string, which Storybook compiles to one) is matched. */
type StoryDescriptor = string[] | RegExp;

interface IStoryFilter {
  includeStories?: StoryDescriptor;
  excludeStories?: StoryDescriptor;
}

type StoryFilterKey = keyof IStoryFilter;

const NAMED_EXPORTS_ORDER = "__namedExportsOrder";

function isStoryFilterKey(name: string): name is StoryFilterKey {
  return name === "includeStories" || name === "excludeStories";
}

/** Removes the wrappers Storybook looks through around the meta object: `as`, `satisfies`, and parentheses. */
function unwrapExpression(node: Node): Node {
  if (Node.isAsExpression(node) || Node.isSatisfiesExpression(node) || Node.isParenthesizedExpression(node)) {
    return unwrapExpression(node.getExpression());
  }
  return node;
}

/** Finds the object literal of the default export, directly or through the variable it names. */
function getMetaObject(sourceFile: SourceFile): ObjectLiteralExpression | undefined {
  const declaration = sourceFile.getExportedDeclarations().get("default")?.[0];
  if (!declaration) {
    return undefined;
  }
  const initializer = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : declaration;
  const meta = initializer ? unwrapExpression(initializer) : undefined;
  return Node.isObjectLiteralExpression(meta) ? meta : undefined;
}

/**
 * Parses an `includeStories` / `excludeStories` value the way Storybook's indexer does (`parseIncludeExclude` in
 * `storybook/internal/csf-tools`): an array of string literals, a string literal compiled to a regex, or a regex
 * literal. Returns undefined for anything else, which Storybook rejects.
 */
function parseStoryDescriptor(node: Node | undefined): StoryDescriptor | undefined {
  try {
    if (Node.isArrayLiteralExpression(node)) {
      const elements = node.getElements();
      return elements.every((element) => Node.isStringLiteral(element))
        ? elements.map((element) => element.getLiteralValue())
        : undefined;
    }
    if (Node.isStringLiteral(node)) {
      return new RegExp(node.getLiteralValue());
    }
    if (Node.isRegularExpressionLiteral(node)) {
      return node.getLiteralValue();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Reads `includeStories` / `excludeStories` from the meta object. Like Storybook's indexer, only properties with
 * identifier keys are read, so spreads and quoted keys are skipped. Returns an empty filter, which makes every
 * named export a story, when the default export is not an object literal or a filter value cannot be read.
 */
function readStoryFilter(sourceFile: SourceFile): IStoryFilter {
  const meta = getMetaObject(sourceFile);
  if (!meta) {
    return {};
  }

  const filter: IStoryFilter = {};
  for (const property of meta.getProperties()) {
    if (Node.isSpreadAssignment(property) || !Node.isIdentifier(property.getNameNode())) {
      continue;
    }
    const name = property.getName();
    if (!isStoryFilterKey(name)) {
      continue;
    }
    const descriptor = Node.isPropertyAssignment(property)
      ? parseStoryDescriptor(property.getInitializer())
      : undefined;
    if (!descriptor) {
      return {};
    }
    filter[name] = descriptor;
  }
  return filter;
}

function matchesStoryDescriptor(exportName: string, descriptor: StoryDescriptor): boolean {
  return Array.isArray(descriptor) ? descriptor.includes(exportName) : exportName.match(descriptor) !== null;
}

/**
 * Creates the predicate for the exports Storybook reads from a story file: the default export (the CSF meta),
 * `__namedExportsOrder`, and the named variable and function exports that are stories. The indexer treats exported
 * variables and functions as stories (types, classes, and enums are not), keeping those that `includeStories`
 * matches, when set, and that `excludeStories` does not match, as Storybook's `isExportStory` does.
 */
export function createIsCsfExport(sourceFile: SourceFile): IsCsfExportFn {
  const { includeStories, excludeStories } = readStoryFilter(sourceFile);

  return (exportName, declarations) => {
    if (exportName === "default" || exportName === NAMED_EXPORTS_ORDER) {
      return true;
    }
    const declaration = declarations[0];
    if (!Node.isVariableDeclaration(declaration) && !Node.isFunctionDeclaration(declaration)) {
      return false;
    }
    return (
      (!includeStories || matchesStoryDescriptor(exportName, includeStories)) &&
      (!excludeStories || !matchesStoryDescriptor(exportName, excludeStories))
    );
  };
}
