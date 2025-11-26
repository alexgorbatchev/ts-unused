import path from "node:path";
import { Project } from "ts-morph";
import { findUnusedExports } from "./findUnusedExports";
import { findUnusedProperties } from "./findUnusedProperties";
import { hasNoCheck } from "./hasNoCheck";
import { isTestFile as defaultIsTestFile } from "./isTestFile";
import type { AnalysisResults, IsTestFileFn, UnusedExportResult, UnusedPropertyResult } from "./types";

export function analyzeProject(
  tsConfigPath: string,
  onProgress?: (current: number, total: number, filePath: string) => void,
  targetFilePath?: string,
  isTestFile: IsTestFileFn = defaultIsTestFile
): AnalysisResults {
  const project: Project = new Project({
    tsConfigFilePath: tsConfigPath,
  });

  const tsConfigDir: string = path.dirname(tsConfigPath);

  // Get total file count for progress reporting
  const allSourceFiles = project.getSourceFiles();
  const filesToAnalyze = allSourceFiles.filter((sf) => {
    if (isTestFile(sf)) {
      return false;
    }
    if (hasNoCheck(sf)) {
      return false;
    }
    if (targetFilePath && sf.getFilePath() !== targetFilePath) {
      return false;
    }
    return true;
  });
  const totalFiles: number = filesToAnalyze.length;

  let currentFile = 0;
  const filesProcessed = new Set<string>();
  const progressCallback = onProgress
    ? (filePath: string) => {
        // Only increment once per file (called from both exports and properties analysis)
        if (!filesProcessed.has(filePath)) {
          filesProcessed.add(filePath);
          currentFile++;
          onProgress(currentFile, totalFiles, filePath);
        }
      }
    : undefined;

  const unusedExports: UnusedExportResult[] = findUnusedExports(
    project,
    tsConfigDir,
    isTestFile,
    progressCallback,
    targetFilePath
  );
  const unusedProperties: UnusedPropertyResult[] = findUnusedProperties(
    project,
    tsConfigDir,
    isTestFile,
    progressCallback,
    targetFilePath
  );

  // Identify completely unused files (where all exports are unused)
  const unusedFiles: string[] = [];
  const fileExportCounts = new Map<string, { total: number; unused: number }>();

  // Count total exports per file
  for (const sourceFile of filesToAnalyze) {
    const filePath = path.relative(tsConfigDir, sourceFile.getFilePath());
    const exports = sourceFile.getExportedDeclarations();
    const totalExports = exports.size;

    if (totalExports > 0) {
      fileExportCounts.set(filePath, { total: totalExports, unused: 0 });
    }
  }

  // Count unused exports per file
  for (const unusedExport of unusedExports) {
    const counts = fileExportCounts.get(unusedExport.filePath);
    if (counts) {
      counts.unused++;
    }
  }

  // Identify files where all exports are unused
  for (const [filePath, counts] of fileExportCounts.entries()) {
    if (counts.total > 0 && counts.unused === counts.total) {
      unusedFiles.push(filePath);
    }
  }

  const results: AnalysisResults = {
    unusedExports,
    unusedProperties,
    unusedFiles,
  };

  return results;
}
