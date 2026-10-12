export type { IAnalyzeProjectOptions } from "./analyzeProject";
export { analyzeProject } from "./analyzeProject";
export type { IUnusedConfig, RuleName, RuleSeverity } from "./config";
export { defaultConfig, defineConfig, mergeConfig } from "./config";
export { COMMENT_KIND, EXPORT_KIND, RULE_NAME, RULE_SEVERITY, SEVERITY } from "./constants";
export type { IFixResults } from "./fixProject";
export { fixProject } from "./fixProject";
export { formatResults } from "./formatResults";
export type { IPropertyUsageResult } from "./isPropertyUnused";
export { createIsTestFile, isTestFile } from "./isTestFile";
export { loadConfig, loadConfigSync } from "./loadConfig";
export { matchesFilePattern, matchesPattern, patternToRegex } from "./patternMatcher";
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
} from "./types";
