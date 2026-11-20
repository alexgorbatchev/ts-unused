import {
  isArrayLiteralExpression,
  isAsExpression,
  isFunctionDeclaration,
  isIdentifier,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAssignment,
  isRegularExpressionLiteral,
  isSatisfiesExpression,
  isSpreadAssignment,
  isStringLiteral,
  isVariableDeclaration,
  type Node,
  type ObjectLiteralExpression,
} from "typescript/ast";

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
  if (isAsExpression(node) || isSatisfiesExpression(node) || isParenthesizedExpression(node)) {
    return unwrapExpression(node.expression);
  }
  return node;
}

/** Finds the object literal of the default export, directly or through the variable it names. */
function getMetaObject(declaration: Node | undefined): ObjectLiteralExpression | undefined {
  if (!declaration) {
    return undefined;
  }
  const initializer = isVariableDeclaration(declaration) ? declaration.initializer : declaration;
  const meta = initializer ? unwrapExpression(initializer) : undefined;
  return meta && isObjectLiteralExpression(meta) ? meta : undefined;
}

/**
 * Parses an `includeStories` / `excludeStories` value the way Storybook's indexer does (`parseIncludeExclude` in
 * `storybook/internal/csf-tools`): an array of string literals, a string literal compiled to a regex, or a regex
 * literal. Returns undefined for anything else, which Storybook rejects.
 */
function parseStoryDescriptor(node: Node | undefined): StoryDescriptor | undefined {
  if (!node) return undefined;
  try {
    if (isArrayLiteralExpression(node)) {
      const names: string[] = [];
      for (const element of node.elements) {
        if (!isStringLiteral(element)) return undefined;
        names.push(element.text);
      }
      return names;
    }
    if (isStringLiteral(node)) {
      return new RegExp(node.text);
    }
    if (isRegularExpressionLiteral(node)) {
      const end = node.text.lastIndexOf("/");
      return new RegExp(node.text.slice(1, end), node.text.slice(end + 1));
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
function readStoryFilter(declaration: Node | undefined): IStoryFilter {
  const meta = getMetaObject(declaration);
  if (!meta) {
    return {};
  }

  const filter: IStoryFilter = {};
  for (const property of meta.properties) {
    if (isSpreadAssignment(property) || !isIdentifier(property.name)) {
      continue;
    }
    const name = property.name.text;
    if (!isStoryFilterKey(name)) {
      continue;
    }
    const descriptor = isPropertyAssignment(property) ? parseStoryDescriptor(property.initializer) : undefined;
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
export function createIsCsfExport(declaration: Node | undefined): IsCsfExportFn {
  const { includeStories, excludeStories } = readStoryFilter(declaration);

  return (exportName, declarations) => {
    if (exportName === "default" || exportName === NAMED_EXPORTS_ORDER) {
      return true;
    }
    const declaration = declarations[0];
    if (!declaration || (!isVariableDeclaration(declaration) && !isFunctionDeclaration(declaration))) {
      return false;
    }
    return (
      (!includeStories || matchesStoryDescriptor(exportName, includeStories)) &&
      (!excludeStories || !matchesStoryDescriptor(exportName, excludeStories))
    );
  };
}
