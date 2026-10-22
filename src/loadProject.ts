import { Project, type SourceFile } from "ts-morph";

export interface ILoadedProject {
  project: Project;
  projectFiles: SourceFile[];
}

/**
 * Loads a tsconfig project and records which source files belong to it before resolving dependencies,
 * so files reached only through imports (outside the tsconfig) are analyzable but never reported or edited.
 */
export function loadProject(tsConfigPath: string): ILoadedProject {
  const project = new Project({ tsConfigFilePath: tsConfigPath, skipFileDependencyResolution: true });
  const projectFiles = project.getSourceFiles();
  project.resolveSourceFileDependencies();
  return { project, projectFiles };
}
