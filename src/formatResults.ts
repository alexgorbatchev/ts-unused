import { SEVERITY } from "./constants.js";
import path from "node:path";
import type {
  IAnalysisResults,
  INeverReturnedTypeResult,
  IDuplicateTypeResult,
  Severity,
  IUnusedExportResult,
  IUnusedPropertyResult,
} from "./types.js";

function getSeverityMarker(severity: Severity): string {
  const markers: Record<Severity, string> = {
    [SEVERITY.ERROR]: "[ERROR]",
    [SEVERITY.WARNING]: "[WARNING]",
    [SEVERITY.INFO]: "[INFO]",
  };
  return markers[severity];
}

function getRelativePath(filePath: string, tsConfigDir: string, cwd: string): string {
  const absolutePath = path.resolve(tsConfigDir, filePath);
  return path.relative(cwd, absolutePath);
}

type UsageFlags = Pick<IUnusedExportResult, "onlyUsedInTests" | "onlyUsedInStories">;

function getUsageStatus(item: UsageFlags): string | undefined {
  if (item.onlyUsedInStories) {
    return "Used only in stories";
  }
  return item.onlyUsedInTests ? "Used only in tests" : undefined;
}

function formatExportLine(item: IUnusedExportResult): string {
  const marker: string = getSeverityMarker(item.severity);
  const status = getUsageStatus(item) ?? `Unused ${item.kind}`;
  const todoSuffix = item.todoComment ? `: [TODO] ${item.todoComment}` : "";
  return `  ${item.exportName}:${item.line}:${item.character}-${item.endCharacter} ${marker} (${status}${todoSuffix})`;
}

function formatPropertyLine(item: IUnusedPropertyResult): string {
  const status: string = getUsageStatus(item) ?? "Unused property";
  const todoSuffix: string = item.todoComment ? `: [TODO] ${item.todoComment}` : "";
  const marker: string = getSeverityMarker(item.severity);
  return `  ${item.typeName}.${item.propertyName}:${item.line}:${item.character}-${item.endCharacter} ${marker} (${status}${todoSuffix})`;
}

function formatNeverReturnedLine(item: INeverReturnedTypeResult): string {
  const marker: string = getSeverityMarker(item.severity);
  return `  ${item.functionName}:${item.line}:${item.character}-${item.endCharacter} ${marker} (Type '${item.neverReturnedType}' in return type is never returned)`;
}

interface IFilePathItem {
  filePath: string;
}

type ItemFormatter<T> = (item: T) => string;

function formatGroupedItems<T extends IFilePathItem>(
  items: T[],
  formatter: ItemFormatter<T>,
  tsConfigDir: string,
  cwd: string,
): string[] {
  const lines: string[] = [];
  const grouped = groupByFile(items);

  for (const [filePath, groupItems] of grouped.entries()) {
    lines.push(getRelativePath(filePath, tsConfigDir, cwd));
    for (const item of groupItems) {
      lines.push(formatter(item));
    }
    lines.push("");
  }

  return lines;
}

export function formatResults(results: IAnalysisResults, tsConfigDir: string): string {
  const lines: string[] = [];
  const cwd = process.cwd();

  const severityRanks: Record<Severity, number> = { [SEVERITY.INFO]: 0, [SEVERITY.WARNING]: 1, [SEVERITY.ERROR]: 2 };
  const unusedExportSeverities = new Map<string, Severity>();
  for (const exportItem of results.unusedExports) {
    unusedExportSeverities.set(`${exportItem.filePath}:${exportItem.exportName}`, exportItem.severity);
  }

  // Filter out properties whose parent type/interface is already reported as unused
  const propertiesToReport: IUnusedPropertyResult[] = results.unusedProperties.filter((prop) => {
    const parentSeverity = unusedExportSeverities.get(`${prop.filePath}:${prop.typeName}`);
    return parentSeverity === undefined || severityRanks[prop.severity] > severityRanks[parentSeverity];
  });

  // Create a set of completely unused files to exclude from export reporting
  const unusedFileSet = new Set(results.unusedFiles);

  // Filter out exports from completely unused files
  const fileSeverity = results.unusedFileSeverity ?? SEVERITY.ERROR;
  const exportsToReport = results.unusedExports.filter(
    (exp) => !unusedFileSet.has(exp.filePath) || severityRanks[exp.severity] > severityRanks[fileSeverity],
  );

  // Report completely unused files first
  if (results.unusedFiles.length > 0) {
    lines.push("Completely Unused Files:");
    lines.push("");
    for (const filePath of results.unusedFiles) {
      lines.push(getRelativePath(filePath, tsConfigDir, cwd));
      lines.push(`  file:1:1-1 ${getSeverityMarker(fileSeverity)} (All exports unused - file can be deleted)`);
      lines.push("");
    }
  }

  if (exportsToReport.length > 0) {
    lines.push("Unused Exports:");
    lines.push("");
    lines.push(...formatGroupedItems(exportsToReport, formatExportLine, tsConfigDir, cwd));
  }

  if (propertiesToReport.length > 0) {
    lines.push("Unused Type/Interface Properties:");
    lines.push("");
    lines.push(...formatGroupedItems(propertiesToReport, formatPropertyLine, tsConfigDir, cwd));
  }

  const neverReturnedTypes = results.neverReturnedTypes || [];
  if (neverReturnedTypes.length > 0) {
    lines.push("Never-Returned Types:");
    lines.push("");
    lines.push(...formatGroupedItems(neverReturnedTypes, formatNeverReturnedLine, tsConfigDir, cwd));
  }

  const duplicateTypes = results.duplicateTypes ?? [];
  if (duplicateTypes.length > 0) {
    lines.push("Duplicate Types:");
    lines.push("");
    const formatDuplicate = (item: IDuplicateTypeResult): string => {
      const original = item.duplicateOf;
      const originalPath = getRelativePath(original.filePath, tsConfigDir, cwd);
      return `  ${item.typeName}:${item.line}:${item.character}-${item.endCharacter} ${getSeverityMarker(item.severity)} (Duplicate of ${original.typeName} at ${originalPath}:${original.line}:${original.character})`;
    };
    lines.push(...formatGroupedItems(duplicateTypes, formatDuplicate, tsConfigDir, cwd));
  }

  if (
    results.unusedFiles.length === 0 &&
    exportsToReport.length === 0 &&
    propertiesToReport.length === 0 &&
    neverReturnedTypes.length === 0 &&
    duplicateTypes.length === 0
  ) {
    lines.push("No unused exports or properties found!");
  } else {
    lines.push("Summary:");
    lines.push(`  Completely unused files: ${results.unusedFiles.length}`);
    lines.push(`  Unused exports: ${exportsToReport.length}`);
    lines.push(`  Unused properties: ${propertiesToReport.length}`);
    lines.push(`  Never-returned types: ${neverReturnedTypes.length}`);
    if (duplicateTypes.length > 0) {
      lines.push(`  Duplicate types: ${duplicateTypes.length}`);
    }
  }

  return lines.join("\n");
}

function groupByFile<T extends IFilePathItem>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const item of items) {
    const existing = grouped.get(item.filePath);
    if (existing) {
      existing.push(item);
    } else {
      grouped.set(item.filePath, [item]);
    }
  }

  return grouped;
}
