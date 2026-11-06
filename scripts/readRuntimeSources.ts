import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { ts } from "ts-morph";

export async function readRuntimeSources(root: string): Promise<string[]> {
  for (const pattern of ["src", "src/**"]) {
    for await (const entry of new Bun.Glob(pattern).scan({
      cwd: root,
      dot: true,
      onlyFiles: false,
      followSymlinks: false,
    })) {
      if ((await lstat(resolve(root, entry))).isSymbolicLink()) {
        throw new Error(`Symbolic links are unsupported in the runtime source inventory: ${entry}`);
      }
    }
  }
  const sources: string[] = [];
  const glob = new Bun.Glob("src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}");
  for await (const source of glob.scan({ cwd: root, dot: true })) {
    if (source.split(/[\\/]/u).includes("__tests__") || /\.d\.[cm]?ts$/u.test(source)) continue;
    const sourcePath = resolve(root, source);
    const result = ts.transpileModule(await Bun.file(sourcePath).text(), {
      fileName: sourcePath,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.Preserve,
        moduleDetection: ts.ModuleDetectionKind.Force,
        verbatimModuleSyntax: true,
        removeComments: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
    if (result.diagnostics?.length) throw new Error(`Cannot inspect runtime source: ${source}`);
    const output = ts.createSourceFile("output.js", result.outputText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
    const isErased = output.statements.every(
      (statement) =>
        ts.isEmptyStatement(statement) ||
        (ts.isExportDeclaration(statement) &&
          !statement.moduleSpecifier &&
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.length === 0),
    );
    if (!isErased) sources.push(sourcePath);
  }
  return sources.sort();
}
