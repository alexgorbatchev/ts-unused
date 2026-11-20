import fs from "node:fs";
import path from "node:path";
import {
  isBindingElement,
  isExportDeclaration,
  isExportSpecifier,
  isFunctionDeclaration,
  isImportDeclaration,
  isInterfaceDeclaration,
  isNamespaceImport,
  isPropertySignatureDeclaration,
  isTypeAliasDeclaration,
  isTypeLiteralNode,
  isVariableDeclaration,
  isVariableDeclarationList,
  isVariableStatement,
  type Node,
  type SourceFile,
  type VariableDeclarationList,
} from "typescript/ast";
import { API } from "typescript/async";
import { descendants } from "./analyzeFunctionReturnTypes.js";
import { analyzeSnapshot, type IsTestFileFnOrOptions } from "./analyzeProject.js";
import { checkGitStatus } from "./checkGitStatus.js";
import { classifyExportReferences } from "./classifyExportReferences.js";
import { mergeConfig } from "./config.js";
import { SEVERITY } from "./constants.js";
import { findModuleReferences } from "./findModuleReferences.js";
import { findNativeReferenceNodes } from "./findNativeReferenceNodes.js";
import { planReturnTypeEdit } from "./fixReturnTypes.js";
import { getNativeExports } from "./getNativeExports.js";
import { isIgnoredFile } from "./isIgnoredFile.js";
import { getProjectFiles, loadProject, resolveConfigPath } from "./loadProject.js";
import { planSpecifierEdits, type RemovableSpecifier } from "./removeSpecifier.js";
import { applySourceEdits, removeListElements, removeSourceNode, type ISourceEdit } from "./sourceEdits.js";
import type { INeverReturnedTypeResult, IUnusedExportResult, IUnusedPropertyResult } from "./types.js";

export type FixProgressCallback = (message: string) => void;

export interface IFixResults {
  fixedExports: number;
  fixedProperties: number;
  fixedNeverReturnedTypes: number;
  deletedFiles: number;
  skippedFiles: string[];
  errors: Array<{ file: string; error: string }>;
}

interface IFileEdits {
  edits: ISourceEdit[];
  specifiers: Set<RemovableSpecifier>;
  messages: string[];
  fixedExports: number;
  fixedProperties: number;
  fixedNeverReturnedTypes: number;
}

type UnusedDeclarationFinding = IUnusedExportResult | IUnusedPropertyResult;

interface IExportRemoval {
  declarations: Node[];
  specifiers: RemovableSpecifier[];
}

function isFixable(finding: UnusedDeclarationFinding): boolean {
  return (
    finding.severity === SEVERITY.ERROR &&
    !finding.onlyUsedInTests &&
    !finding.onlyUsedInStories &&
    finding.todoComment === undefined
  );
}

function planDeclarationEdits(declarations: ReadonlySet<Node>, source: SourceFile): ISourceEdit[] {
  const edits: ISourceEdit[] = [];
  const groups = new Set<VariableDeclarationList>();
  for (const declaration of declarations) {
    if (
      isVariableDeclaration(declaration) &&
      isVariableDeclarationList(declaration.parent) &&
      isVariableStatement(declaration.parent.parent)
    ) {
      groups.add(declaration.parent);
    } else {
      edits.push(removeSourceNode(declaration, source));
    }
  }
  for (const group of groups) {
    if (group.declarations.every((declaration) => declarations.has(declaration))) {
      edits.push(removeSourceNode(group.parent, source));
    } else {
      edits.push(...removeListElements(group.declarations, declarations, source));
    }
  }
  return edits;
}

export async function fixProject(
  tsConfigPath: string,
  onProgress?: FixProgressCallback,
  isTestFileOrOptions?: IsTestFileFnOrOptions,
): Promise<IFixResults> {
  const results: IFixResults = {
    fixedExports: 0,
    fixedProperties: 0,
    fixedNeverReturnedTypes: 0,
    deletedFiles: 0,
    skippedFiles: [],
    errors: [],
  };
  const configPath = resolveConfigPath(tsConfigPath);
  const directory = path.dirname(configPath);
  const relative = (file: string) => path.relative(directory, file);
  const dirty = checkGitStatus(directory);
  const { ignoreFilePatterns } = mergeConfig(
    typeof isTestFileOrOptions === "object" ? (isTestFileOrOptions.config ?? {}) : {},
  );

  await using api = new API();
  await using loaded = await loadProject(api, configPath);
  const { project } = loaded;
  const projectFiles = await getProjectFiles(project);
  const analysis = await analyzeSnapshot(project, configPath, projectFiles, undefined, undefined, isTestFileOrOptions);
  const files = new Map<string, SourceFile>(projectFiles.map((source) => [source.fileName, source]));
  const ignored = new Set([...files.keys()].filter((file) => isIgnoredFile(file, directory, ignoreFilePatterns)));
  const editable = (file: string) => files.has(file) && !ignored.has(file) && !dirty.has(file);
  const skipped = new Set<string>();
  function skipDirty(file: string): void {
    if (dirty.has(file) && !skipped.has(file)) {
      skipped.add(file);
      onProgress?.(`Skipped: ${relative(file)} (has local git changes)`);
    }
  }
  function blocked(target: string, sources: Iterable<string>): boolean {
    let hasBlocker = false;
    for (const file of new Set(sources)) {
      if (editable(file)) continue;
      hasBlocker = true;
      const reason = ignored.has(file)
        ? "which matches ignoreFilePatterns"
        : files.has(file)
          ? "which has local git changes"
          : "outside the analyzed tsconfig";
      onProgress?.(`Skipped: ${target} (named in ${relative(file)}, ${reason})`);
      if (dirty.has(file) && files.has(file) && !ignored.has(file)) skipped.add(file);
    }
    return hasBlocker;
  }

  const edits = new Map<string, IFileEdits>();
  function plan(file: string): IFileEdits {
    let existing = edits.get(file);
    if (!existing) {
      existing = {
        edits: [],
        specifiers: new Set(),
        messages: [],
        fixedExports: 0,
        fixedProperties: 0,
        fixedNeverReturnedTypes: 0,
      };
      edits.set(file, existing);
    }
    return existing;
  }
  function recordError(file: string, action: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    results.errors.push({ file: relative(file), error: message });
    onProgress?.(`Error ${action} ${relative(file)}: ${message}`);
  }
  function checkSnapshot(source: SourceFile): string {
    const current = fs.readFileSync(source.fileName, "utf8");
    if (current !== source.text && current !== `\uFEFF${source.text}`) {
      throw new Error("File changed since TypeScript loaded it");
    }
    return current;
  }

  const candidates = new Map<string, IUnusedExportResult[]>();
  const deletions = new Set<string>(
    analysis.unusedFileSeverity === SEVERITY.ERROR
      ? analysis.unusedFiles.map((file) => path.resolve(directory, file))
      : [],
  );
  for (const finding of analysis.unusedExports) {
    const file = path.resolve(directory, finding.filePath);
    if (!isFixable(finding) && !deletions.has(file)) continue;
    skipDirty(file);
    if (!editable(file)) continue;
    const entries = candidates.get(file) ?? [];
    entries.push(finding);
    candidates.set(file, entries);
  }

  const references = candidates.size ? await findModuleReferences(project, new Set(files.keys())) : undefined;
  const deleted = new Map<string, string>();
  const brokenReExports = new Map<string, Set<Node>>();
  function planFileDeletion(file: string, reason: string): void {
    deleted.set(file, reason);
    for (const { source, statement } of references?.get(file) ?? []) {
      const change = plan(source.fileName);
      change.edits.push(removeSourceNode(statement, source));
      if (isExportDeclaration(statement)) {
        const broken = brokenReExports.get(source.fileName) ?? new Set<Node>();
        broken.add(statement);
        brokenReExports.set(source.fileName, broken);
        change.messages.push(`  ✓ Removed broken re-export from: ${statement.moduleSpecifier?.getText(source)}`);
      }
    }
  }

  for (const [file, findings] of candidates) {
    const source = files.get(file)!;
    const exported = await getNativeExports(project, source);
    const moduleSources = references?.get(file) ?? [];
    const deleting = deletions.has(file);
    if (
      deleting &&
      blocked(
        relative(file),
        moduleSources.map(({ source }) => source.fileName),
      )
    )
      continue;
    const namespaces = moduleSources.flatMap(({ statement }) => {
      const binding = isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
      return binding && isNamespaceImport(binding) ? [binding] : [];
    });
    if (
      findings.length === exported.size &&
      blocked(
        relative(file),
        namespaces.map((node) => node.getSourceFile().fileName),
      )
    )
      continue;

    const removals = new Map<string, IExportRemoval>();
    let blockedDeletion = false;
    for (const finding of findings) {
      const declarations = (exported.get(finding.exportName) ?? []).filter((node) => node.getSourceFile() === source);
      // Destructuring declarations can include live bindings and require initializer-aware edits.
      if (!declarations.length || declarations.some(isBindingElement)) {
        blockedDeletion = true;
        continue;
      }
      const references = await Promise.all(declarations.map((node) => findNativeReferenceNodes(project, node)));
      const { specifiers } = classifyExportReferences(references.flat());
      if (
        blocked(
          `${relative(file)}:${finding.exportName}`,
          specifiers.map((node) => node.getSourceFile().fileName),
        )
      ) {
        blockedDeletion = true;
        continue;
      }
      if (isFixable(finding)) removals.set(finding.exportName, { declarations, specifiers });
    }

    if (deleting && !blockedDeletion) {
      planFileDeletion(file, "all exports unused");
      continue;
    }

    const targets = new Set<Node>();
    for (const [name, removal] of removals) {
      if (!deleted.has(file)) {
        for (const declaration of removal.declarations) targets.add(declaration);
        const change = plan(file);
        change.fixedExports++;
        change.messages.push(`  ✓ Removed unused export: ${name}`);
      }
      for (const specifier of removal.specifiers) {
        const source = specifier.getSourceFile();
        const change = plan(source.fileName);
        change.specifiers.add(specifier);
        change.messages.push(
          `  ✓ Removed ${isExportSpecifier(specifier) ? "re-export" : "import"} of unused export: ${specifier.getText(source)} (${relative(source.fileName)})`,
        );
      }
    }
    if (targets.size) plan(file).edits.push(...planDeclarationEdits(targets, source));
    if (removals.size === exported.size && !deleted.has(file)) {
      for (const binding of namespaces) {
        const source = binding.getSourceFile();
        const change = plan(source.fileName);
        change.specifiers.add(binding);
        change.messages.push(
          `  ✓ Removed import of file without exports: ${binding.getText(source)} (${relative(source.fileName)})`,
        );
      }
    }
  }

  // Revisit earlier barrels when another deletion removes the last of their re-exports.
  let removedBarrels: boolean;
  do {
    removedBarrels = false;
    for (const [file, broken] of brokenReExports) {
      if (deleted.has(file) || !editable(file)) continue;
      const source = files.get(file)!;
      if (!source.statements.every((statement) => broken.has(statement))) continue;
      // A surviving importer can still use the file as a module or for its side effects.
      if ((references?.get(file) ?? []).some((reference) => !deleted.has(reference.source.fileName))) continue;
      planFileDeletion(file, "only re-exports from deleted files");
      removedBarrels = true;
    }
  } while (removedBarrels);

  const propertyFindings = new Map<string, Map<string, IUnusedPropertyResult>>();
  const returnFindings = new Map<string, Map<string, INeverReturnedTypeResult[]>>();
  for (const finding of analysis.unusedProperties.filter(isFixable)) {
    const file = path.resolve(directory, finding.filePath);
    skipDirty(file);
    if (!editable(file) || deleted.has(file)) continue;
    const existing = propertyFindings.get(file) ?? new Map<string, IUnusedPropertyResult>();
    existing.set(`${finding.line}:${finding.character}`, finding);
    propertyFindings.set(file, existing);
  }
  for (const finding of analysis.neverReturnedTypes ?? []) {
    if (finding.severity !== SEVERITY.ERROR) continue;
    const file = path.resolve(directory, finding.filePath);
    skipDirty(file);
    if (!editable(file) || deleted.has(file)) continue;
    const existing = returnFindings.get(file) ?? new Map<string, INeverReturnedTypeResult[]>();
    const key = `${finding.line}:${finding.character}`;
    existing.set(key, [...(existing.get(key) ?? []), finding]);
    returnFindings.set(file, existing);
  }

  for (const file of new Set([...propertyFindings.keys(), ...returnFindings.keys()])) {
    const source = files.get(file)!;
    const change = plan(file);
    const isRemoved = (node: Node) =>
      change.edits.some((edit) => edit.text === "" && edit.start <= node.getStart(source) && edit.end >= node.end);
    const keyAt = (node: Node) => {
      const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
      return `${line + 1}:${character + 1}`;
    };
    if (propertyFindings.has(file)) {
      for (const statement of source.statements) {
        const shape = isInterfaceDeclaration(statement)
          ? statement
          : isTypeAliasDeclaration(statement)
            ? statement.type
            : undefined;
        if (!shape || (!isInterfaceDeclaration(shape) && !isTypeLiteralNode(shape)) || isRemoved(statement)) continue;
        for (const member of shape.members) {
          if (!isPropertySignatureDeclaration(member)) continue;
          const finding = propertyFindings.get(file)?.get(keyAt(member));
          if (!finding) continue;
          change.edits.push(removeSourceNode(member, source));
          change.fixedProperties++;
          change.messages.push(`  ✓ Removed unused property: ${finding.typeName}.${finding.propertyName}`);
        }
      }
    }
    if (returnFindings.has(file)) {
      for (const node of descendants(source)) {
        if (!isFunctionDeclaration(node) || !node.name || isRemoved(node)) continue;
        const findings = returnFindings.get(file)?.get(keyAt(node.name));
        if (!findings) continue;
        const edit = await planReturnTypeEdit(
          project.checker,
          node,
          new Set(findings.map((finding) => finding.neverReturnedType)),
        );
        if (!edit) continue;
        change.edits.push(edit);
        change.fixedNeverReturnedTypes += findings.length;
        for (const finding of findings) {
          change.messages.push(
            `  ✓ Removed never-returned type '${finding.neverReturnedType}' from ${finding.functionName}`,
          );
        }
      }
    }
  }

  const updates = new Map<string, string>();
  const latestDirty = checkGitStatus(directory);
  for (const file of new Set([...edits.keys(), ...deleted.keys()])) {
    if (!editable(file)) continue;
    const source = files.get(file)!;
    try {
      if (latestDirty.has(file)) throw new Error("File acquired local git changes while planning fixes");
      const current = checkSnapshot(source);
      const change = edits.get(file);
      if (!change || deleted.has(file)) continue;
      const updated = applySourceEdits(source.text, [...change.edits, ...planSpecifierEdits(change.specifiers)]);
      if (updated === source.text) continue;
      const hasBom = current.startsWith("\uFEFF") && !source.text.startsWith("\uFEFF");
      updates.set(file, hasBom ? `\uFEFF${updated}` : updated);
    } catch (error) {
      recordError(file, "planning fixes for", error);
    }
  }

  if (!results.errors.length) {
    for (const [file, updated] of updates) {
      const change = edits.get(file)!;
      try {
        onProgress?.(`Fixing: ${relative(file)}`);
        checkSnapshot(files.get(file)!);
        fs.writeFileSync(file, updated);
        results.fixedExports += change.fixedExports;
        results.fixedProperties += change.fixedProperties;
        results.fixedNeverReturnedTypes += change.fixedNeverReturnedTypes;
        for (const message of change.messages) onProgress?.(message);
      } catch (error) {
        recordError(file, "fixing", error);
        break;
      }
    }
  }

  // Leave modules in place if any edit to a referring file failed.
  if (!results.errors.length) {
    for (const [file, reason] of deleted) {
      try {
        onProgress?.(`Deleting: ${relative(file)} (${reason})`);
        checkSnapshot(files.get(file)!);
        fs.unlinkSync(file);
        results.deletedFiles++;
      } catch (error) {
        recordError(file, "deleting", error);
        break;
      }
    }
  }

  results.skippedFiles = [...skipped].map(relative);
  return results;
}
