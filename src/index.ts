export type { IAnalyzeProjectOptions } from "./analyzeProject.js";
export { analyzeProject } from "./analyzeProject.js";
export type { IUnusedConfig, RuleName, RuleSeverity } from "./config.js";
export { defaultConfig, defineConfig, mergeConfig } from "./config.js";
export { COMMENT_KIND, EXPORT_KIND, RULE_NAME, RULE_SEVERITY, SEVERITY } from "./constants.js";
export type { IFixResults } from "./fixProject.js";
export { fixProject } from "./fixProject.js";
export { formatResults } from "./formatResults.js";
export type { IPropertyUsageResult } from "./isPropertyUnused.js";
export { createIsTestFile, isTestFile } from "./isTestFile.js";
export { loadConfig, loadConfigSync } from "./loadConfig.js";
export { matchesFilePattern, matchesPattern, patternToRegex } from "./patternMatcher.js";
export type {
  IAnalysisResults,
  ExportKind,
  IsTestFileFn,
  INeverReturnedTypeResult,
  IDuplicateTypeResult,
  ITypeLocation,
  Severity,
  CommentKind,
  IUnusedExportResult,
  IUnusedPropertyResult,
} from "./types.js";
