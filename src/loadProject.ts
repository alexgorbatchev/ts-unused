import fs from "node:fs";
import path from "node:path";
import type { SourceFile } from "typescript/ast";
import { formatDiagnostics, type API, type Project } from "typescript/async";

export function resolveConfigPath(tsConfigPath: string): string {
  return fs.existsSync(tsConfigPath) ? fs.realpathSync(tsConfigPath) : path.resolve(tsConfigPath);
}

export async function loadProject(api: API, configPath: string) {
  const snapshot = await api.createSnapshot({ openProjects: [configPath] });
  try {
    const project = snapshot.getConfiguredProject(configPath);
    if (!project) {
      throw new Error(`TypeScript could not load project: ${configPath}`);
    }
    const diagnostics = await project.program.getConfigFileParsingDiagnostics();
    if (diagnostics.length > 0) {
      throw new Error(formatDiagnostics(diagnostics, project.program));
    }
    return {
      project,
      [Symbol.asyncDispose]: () => snapshot[Symbol.asyncDispose](),
    };
  } catch (error) {
    await snapshot[Symbol.asyncDispose]();
    throw error;
  }
}

export async function getProjectFiles(project: Project): Promise<SourceFile[]> {
  const files = await Promise.all(
    project.parsedCommandLine.fileNames.map((file) => project.program.getSourceFile(file)),
  );
  return files
    .filter((file): file is SourceFile => file !== undefined)
    .sort((left, right) => {
      const depth = left.fileName.split(path.sep).length - right.fileName.split(path.sep).length;
      return depth || left.fileName.toLowerCase().localeCompare(right.fileName.toLowerCase(), "en");
    });
}
