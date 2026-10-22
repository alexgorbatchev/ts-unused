import { Project, type SourceFile } from "ts-morph";

export interface ILoadedProject {
  project: Project;
  projectFiles: SourceFile[];
}

export function loadProject(tsConfigPath: string): ILoadedProject {
  const project = new Project({ tsConfigFilePath: tsConfigPath, skipFileDependencyResolution: true });
  const projectFiles = project.getSourceFiles();
  project.resolveSourceFileDependencies();
  return { project, projectFiles };
}
