import { RULE_NAME, RULE_SEVERITY, USAGE_SOURCE } from "./constants.js";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { type Node, type SourceFile } from "typescript/ast";
import { API, type Project } from "typescript/async";
import { analyzeFunctionReturnTypes } from "./analyzeFunctionReturnTypes.js";
import { analyzeNativeDuplicateTypes } from "./analyzeNativeDuplicateTypes.js";
import { analyzeProperties } from "./analyzeProperties.js";
import { checkExportUsage } from "./checkExportUsage.js";
import { createIsCsfExport } from "./createIsCsfExport.js";
import { collectNativePublicApiDeclarations } from "./collectNativePublicApiDeclarations.js";
import { mergeConfig, type IUnusedConfig } from "./config.js";
import { applyRuleSeverities } from "./applyRuleSeverities.js";
import { hasNoCheck } from "./hasNoCheck.js";
import { declarationLocation, findNativeUsedImports } from "./findNativeUsedImports.js";
import { findNativeReferenceNodes } from "./findNativeReferenceNodes.js";
import { findNativeSpecialImports } from "./findNativeSpecialImports.js";
import { createNativePropertyUsage } from "./createNativePropertyUsage.js";
import { getNativeExports } from "./getNativeExports.js";
import { findEmittedDeclarationFiles } from "./findEmittedDeclarationFiles.js";
import { createIsTestFile, isTestFile as defaultIsTestFile } from "./isTestFile.js";
import { getProjectFiles, loadProject, resolveConfigPath } from "./loadProject.js";
import { findPackageJson, getPackageEntryTargets, resolvePackageEntryPoints } from "./packageEntryPoints.js";
import { isIgnoredFile } from "./isIgnoredFile.js";
import { createClassifyUsageSource } from "./usageSourceUtils.js";
import type {
  IAnalysisResults,
  IDuplicateTypeResult,
  IsTestFileFn,
  INeverReturnedTypeResult,
  IUnusedExportResult,
  IUnusedPropertyResult,
} from "./types.js";

export type ProgressCallback = (current: number, total: number, filePath: string) => void;

export interface IAnalyzeProjectOptions {
  /**
   * Configuration options for the analysis.
   */
  config?: IUnusedConfig;

  /**
   * Custom test file detection function (overrides config.testFilePatterns).
   */
  isTestFile?: IsTestFileFn;
}

export type IsTestFileFnOrOptions = IsTestFileFn | IAnalyzeProjectOptions;

export async function analyzeProject(
  tsConfigPath: string,
  onProgress?: ProgressCallback,
  targetFilePath?: string,
  isTestFileOrOptions?: IsTestFileFnOrOptions,
): Promise<IAnalysisResults> {
  const configPath = resolveConfigPath(tsConfigPath);
  const target = targetFilePath && existsSync(targetFilePath) ? realpathSync(targetFilePath) : targetFilePath;
  await using api = new API();
  await using loaded = await loadProject(api, configPath);
  const projectFiles = await getProjectFiles(loaded.project);
  return await analyzeSnapshot(loaded.project, configPath, projectFiles, onProgress, target, isTestFileOrOptions);
}

export async function analyzeSnapshot(
  project: Project,
  configPath: string,
  projectFiles: SourceFile[],
  onProgress?: ProgressCallback,
  target?: string,
  isTestFileOrOptions?: IsTestFileFnOrOptions,
): Promise<IAnalysisResults> {
  // Handle backward compatibility: can pass IsTestFileFn directly or options object
  let options: IAnalyzeProjectOptions = {};
  if (typeof isTestFileOrOptions === "function") {
    options = { isTestFile: isTestFileOrOptions };
  } else if (isTestFileOrOptions) {
    options = isTestFileOrOptions;
  }

  const config = mergeConfig(options.config ?? {});

  // Determine the isTestFile function
  const isTestFile: IsTestFileFn = options.isTestFile
    ? options.isTestFile
    : config.testFilePatterns
      ? createIsTestFile(config.testFilePatterns)
      : defaultIsTestFile;

  const tsConfigDir: string = path.dirname(configPath);
  const classifyUsageSource = createClassifyUsageSource(isTestFile, config.storyFilePatterns, tsConfigDir);

  function getEntryTargets(): string[] | undefined {
    if (!config.packageMode) return undefined;
    const packageJsonPath = findPackageJson(tsConfigDir);
    if (!packageJsonPath) {
      throw new Error(`Package mode is enabled but no package.json was found. ` + `Searched from: ${tsConfigDir}`);
    }

    const targets = getPackageEntryTargets(packageJsonPath);
    if (targets.length === 0) {
      throw new Error(
        `Package mode is enabled but package.json has no entry points. ` +
          `Expected 'main', 'module', 'types', or 'exports' field in: ${packageJsonPath}`,
      );
    }
    return targets;
  }
  const entryTargets = getEntryTargets();
  // Get total file count for progress reporting
  const filesToAnalyze = projectFiles.filter((sf) => {
    if (isTestFile(sf.fileName)) {
      return false;
    }
    if (hasNoCheck(sf.text)) {
      return false;
    }
    return !isIgnoredFile(sf.fileName, tsConfigDir, config.ignoreFilePatterns);
  });
  const targetFiles = target ? filesToAnalyze.filter((sf) => sf.fileName === target) : filesToAnalyze;
  const totalFiles: number = targetFiles.length;

  let currentFile = 0;

  // Build options for analysis
  const exportCheckOptions = {
    ignoreExports: config.ignoreExports,
    ignoreModuleAugmentations: config.ignoreModuleAugmentations,
  };

  // Results arrays
  const unusedExports: IUnusedExportResult[] = [];
  const unusedProperties: IUnusedPropertyResult[] = [];
  const neverReturnedTypes: INeverReturnedTypeResult[] = [];
  const hasCommentRules =
    config.rules[RULE_NAME.TODO_COMMENTS] !== RULE_SEVERITY.OFF ||
    config.rules[RULE_NAME.IGNORE_COMMENTS] !== RULE_SEVERITY.OFF;

  const analyzeExports =
    config.analyzeExports &&
    (config.rules[RULE_NAME.UNUSED_EXPORTS] !== RULE_SEVERITY.OFF ||
      hasCommentRules ||
      (config.detectUnusedFiles && config.rules[RULE_NAME.UNUSED_FILES] !== RULE_SEVERITY.OFF));
  const analyzeReturns =
    config.analyzeNeverReturnedTypes && config.rules[RULE_NAME.NEVER_RETURNED_TYPES] !== RULE_SEVERITY.OFF;
  const analyzePropertyUsage =
    config.analyzeProperties && (config.rules[RULE_NAME.UNUSED_PROPERTIES] !== RULE_SEVERITY.OFF || hasCommentRules);
  const analyzeDuplicates =
    config.analyzeDuplicateTypes && config.rules[RULE_NAME.DUPLICATE_TYPES] !== RULE_SEVERITY.OFF;
  let duplicateTypes: IDuplicateTypeResult[] = [];
  const exportCounts = new Map<string, number>();
  let sideEffectImports: Set<string> | undefined;

  if (
    config.packageMode ||
    (targetFiles.length && (analyzeExports || analyzeReturns || analyzePropertyUsage || analyzeDuplicates))
  ) {
    let packageApi: Awaited<ReturnType<typeof collectNativePublicApiDeclarations>> | undefined;
    if (entryTargets) {
      const entryPoints = await resolvePackageEntryPoints(
        tsConfigDir,
        entryTargets,
        project,
        configPath,
        projectFiles,
        config.packageEntryPointSources,
      );
      if (entryPoints.length === 0) {
        throw new Error(
          `Package mode is enabled but no package.json entry point resolves to a project source file: ${entryTargets.join(", ")}`,
        );
      }
      packageApi = await collectNativePublicApiDeclarations(project, entryPoints, projectFiles);
    }
    if (analyzeExports) {
      const findReferences = (declaration: Node) => findNativeReferenceNodes(project, declaration);
      const specialImports = await findNativeSpecialImports(project, new Set(targetFiles.map((file) => file.fileName)));
      sideEffectImports = specialImports.sideEffects;
      const wholeNamespaceImporters = (file: SourceFile) => [
        ...(specialImports.wholeNamespaces.get(file.fileName) ?? []),
      ];
      const usedImports =
        targetFiles.length > 1 ? await findNativeUsedImports(project, classifyUsageSource) : undefined;
      for (const sourceFile of targetFiles) {
        // Storybook reads the meta and the stories of a story file, so they are used without any reference
        const exports = await getNativeExports(project, sourceFile);
        const isCsfExport =
          classifyUsageSource(sourceFile.fileName) === USAGE_SOURCE.STORY
            ? createIsCsfExport(exports.get("default")?.[0])
            : undefined;
        exportCounts.set(sourceFile.fileName, exports.size);
        for (const [exportName, declarations] of exports.entries()) {
          const first = declarations[0];
          if (
            (first && usedImports?.has(declarationLocation(first.getSourceFile().fileName, first.getStart()))) ||
            isCsfExport?.(exportName, declarations)
          ) {
            continue;
          }
          const unusedExport = await checkExportUsage(
            exportName,
            declarations,
            sourceFile,
            tsConfigDir,
            classifyUsageSource,
            {
              ...exportCheckOptions,
              findReferences,
              wholeNamespaceImporters,
              publicDeclarations: packageApi?.publicDeclarations,
            },
          );
          if (unusedExport) {
            unusedExports.push(unusedExport);
          }
        }
      }
    }

    if (analyzeReturns) {
      for (const sourceFile of targetFiles) {
        neverReturnedTypes.push(...(await analyzeFunctionReturnTypes(project.checker, sourceFile, tsConfigDir)));
      }
    }
    if (analyzePropertyUsage) {
      const propertyUsage = await createNativePropertyUsage(project, classifyUsageSource);
      for (const sourceFile of targetFiles) {
        onProgress?.(++currentFile, totalFiles, path.relative(tsConfigDir, sourceFile.fileName));
        await analyzeProperties(sourceFile, tsConfigDir, unusedProperties, {
          ignoreProperties: config.ignoreProperties,
          ignoreTypes: config.ignoreTypes,
          publicApiDeclarations: packageApi?.publicApiDeclarations,
          propertyUsage,
        });
      }
    }
    if (analyzeDuplicates) {
      const emitted = await findEmittedDeclarationFiles(project, configPath, projectFiles);
      duplicateTypes = await analyzeNativeDuplicateTypes(
        project,
        filesToAnalyze.filter((source) => !emitted.has(source)).map((source) => source.fileName),
        tsConfigDir,
        config.ignoreTypes,
        target,
      );
    }
  }

  if (!analyzePropertyUsage && onProgress) {
    for (const sourceFile of targetFiles) {
      onProgress(++currentFile, totalFiles, path.relative(tsConfigDir, sourceFile.fileName));
    }
  }

  interface IFileExportCount {
    sourceFile: SourceFile;
    total: number;
    unused: number;
    protectedExports: number;
  }

  // Identify completely unused files (where all exports are unused)
  const unusedFiles: string[] = [];

  if (config.detectUnusedFiles && config.rules[RULE_NAME.UNUSED_FILES] !== RULE_SEVERITY.OFF) {
    const fileExportCounts = new Map<string, IFileExportCount>();

    // Count total exports per file
    for (const sourceFile of targetFiles) {
      const filePath = path.relative(tsConfigDir, sourceFile.fileName);
      const totalExports = exportCounts.get(sourceFile.fileName) ?? 0;

      if (totalExports > 0) {
        fileExportCounts.set(filePath, { sourceFile, total: totalExports, unused: 0, protectedExports: 0 });
      }
    }

    // Count unused exports per file
    for (const unusedExport of unusedExports) {
      const counts = fileExportCounts.get(unusedExport.filePath);
      if (counts) {
        counts.unused++;
        if (unusedExport.onlyUsedInTests || unusedExport.onlyUsedInStories || unusedExport.todoComment !== undefined) {
          counts.protectedExports++;
        }
      }
    }

    // Keep TODO/ignore, test-only, and story-only exports, and files imported for side effects, out of deletion
    // candidates.
    for (const [filePath, counts] of fileExportCounts.entries()) {
      const allExportsUnused = counts.total > 0 && counts.unused === counts.total;
      const hasProtectedExports = counts.protectedExports > 0;

      if (allExportsUnused && !hasProtectedExports && !sideEffectImports?.has(counts.sourceFile.fileName)) {
        unusedFiles.push(filePath);
      }
    }
  }

  const results: IAnalysisResults = {
    unusedExports,
    unusedProperties,
    unusedFiles,
    neverReturnedTypes,
    duplicateTypes,
  };

  return applyRuleSeverities(results, config.rules);
}
