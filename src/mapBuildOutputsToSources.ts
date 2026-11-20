import path from "node:path";
import type { SourceFile } from "typescript/ast";
import { JsxEmit, type CompilerOptions } from "typescript/async";

export function toComparablePath(filePath: string): string {
  const normalizedPath = path.resolve(filePath).split(path.sep).join("/");
  return ["darwin", "win32"].includes(process.platform) ? normalizedPath.toLowerCase() : normalizedPath;
}

function getCommonDirectory(files: readonly string[]): string | undefined {
  const [first, ...others] = files.map((file) => path.dirname(file).split(path.sep));
  if (!first) return undefined;
  let length = first.length;
  for (const segments of others) {
    let index = 0;
    while (index < length && first[index] === segments[index]) index++;
    length = index;
  }
  return first.slice(0, length).join(path.sep) || path.parse(files[0]!).root;
}

function outputNames(file: string, root: string, options: CompilerOptions): readonly string[] {
  const extension = path.extname(file).toLowerCase();
  const relative = options.outDir || options.declarationDir ? path.relative(root, file) : path.basename(file);
  const jsDir = options.outDir ?? path.dirname(file);
  const declarationDir = options.declarationDir ?? jsDir;
  const jsExtension = [".mts", ".mjs"].includes(extension)
    ? ".mjs"
    : [".cts", ".cjs"].includes(extension)
      ? ".cjs"
      : [".tsx", ".jsx"].includes(extension) && options.jsx === JsxEmit.Preserve
        ? ".jsx"
        : ".js";
  const declarationExtension = jsExtension === ".mjs" ? ".d.mts" : jsExtension === ".cjs" ? ".d.cts" : ".d.ts";
  const base = relative.slice(0, -extension.length);
  return [
    path.join(jsDir, options.outDir ? base : path.basename(base)) + jsExtension,
    path.join(declarationDir, options.declarationDir || options.outDir ? base : path.basename(base)) +
      declarationExtension,
  ];
}

export function mapBuildOutputsToSources(
  configPath: string,
  options: CompilerOptions,
  projectFiles: readonly SourceFile[],
  programFiles: readonly string[],
): Map<string, SourceFile> {
  const outputs = new Map<string, SourceFile>();
  if ("outFile" in options && options.outFile) return outputs;
  const inputs = projectFiles.filter((source) => !source.isDeclarationFile);
  const root = getCommonDirectory(
    programFiles.filter((file) => !/\.d\.[cm]?ts$/i.test(file) && !file.split(path.sep).includes("node_modules")),
  );
  const roots = options.rootDir ? [options.rootDir] : new Set([path.dirname(configPath), ...(root ? [root] : [])]);
  for (const candidate of roots) {
    for (const source of inputs) {
      for (const output of outputNames(source.fileName, candidate, options)) {
        const key = toComparablePath(output);
        if (!outputs.has(key)) outputs.set(key, source);
      }
    }
  }
  return outputs;
}
