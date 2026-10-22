export const SEVERITY = Object.freeze({
  ERROR: "error",
  WARNING: "warning",
  INFO: "info",
});

export const RULE_SEVERITY = Object.freeze({
  ...SEVERITY,
  OFF: "off",
});

export const RULE_NAME = Object.freeze({
  UNUSED_EXPORTS: "unusedExports",
  UNUSED_PROPERTIES: "unusedProperties",
  UNUSED_FILES: "unusedFiles",
  NEVER_RETURNED_TYPES: "neverReturnedTypes",
  DUPLICATE_TYPES: "duplicateTypes",
  TODO_COMMENTS: "todoComments",
  IGNORE_COMMENTS: "ignoreComments",
  STORY_ONLY_USAGE: "storyOnlyUsage",
});

export const COMMENT_KIND = Object.freeze({
  TODO: "todo",
  IGNORE: "ignore",
});

export const USAGE_SOURCE = Object.freeze({
  PRODUCTION: "production",
  STORY: "story",
  TEST: "test",
});

export const EXPORT_KIND = Object.freeze({
  FUNCTION: "function",
  CLASS: "class",
  INTERFACE: "interface",
  TYPE: "type",
  CONST: "const",
  VARIABLE: "variable",
  ENUM: "enum",
  NAMESPACE: "namespace",
  EXPORT: "export",
});
