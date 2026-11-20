import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  isInterfaceDeclaration,
  isTypeAliasDeclaration,
  isTypeLiteralNode,
  isPropertySignatureDeclaration,
} from "typescript/ast";
import { createNativePropertyUsage } from "../createNativePropertyUsage";
import { isTestFile } from "../isTestFile";
import { createClassifyUsageSource } from "../usageSourceUtils";
import { API, type Project } from "typescript/async";
import { loadProject, resolveConfigPath } from "../loadProject";

type RunNativeProject<T> = (project: Project, root: string) => Promise<T>;

export async function withNativeProject<T>(files: Record<string, string>, run: RunNativeProject<T>): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), "ts-unused-native-"));
  try {
    const config = path.join(directory, "tsconfig.json");
    await writeFile(
      config,
      JSON.stringify({
        compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler" },
        include: ["**/*.ts", "**/*.tsx"],
      }),
    );
    for (const [name, text] of Object.entries(files)) {
      const file = path.join(directory, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text);
    }
    const configPath = resolveConfigPath(config);
    await using api = new API();
    await using loaded = await loadProject(api, configPath);
    return await run(loaded.project, path.dirname(configPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function getUsage(files: Record<string, string>, storyPatterns: string[] = []) {
  return withNativeProject(files, async (project, root) => {
    const lookup = await createNativePropertyUsage(project, createClassifyUsageSource(isTestFile, storyPatterns, root));
    const results = new Map<string, Map<string, Awaited<ReturnType<typeof lookup>>>>();
    for (const file of Object.keys(files)) {
      const source = (await project.program.getSourceFile(path.join(root, file)))!;
      for (const declaration of source.statements) {
        const shape = isInterfaceDeclaration(declaration)
          ? declaration
          : isTypeAliasDeclaration(declaration) && isTypeLiteralNode(declaration.type)
            ? declaration.type
            : undefined;
        if (!shape || !(isInterfaceDeclaration(declaration) || isTypeAliasDeclaration(declaration))) continue;
        const properties = new Map<string, Awaited<ReturnType<typeof lookup>>>();
        for (const member of shape.members) {
          if (isPropertySignatureDeclaration(member)) properties.set(member.name.getText(source), await lookup(member));
        }
        results.set(declaration.name.text, properties);
      }
    }
    return results;
  });
}

import { expect } from "bun:test";
import path from "node:path";

export function runGit(projectDir: string, args: string[]): string {
  const result = Bun.spawnSync(["git", "-c", "maintenance.auto=false", ...args], {
    cwd: projectDir,
    stderr: "pipe",
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  return result.stdout.toString();
}

export function commitFixProject(projectDir: string): void {
  runGit(projectDir, ["init", "--quiet"]);
  runGit(projectDir, ["add", "."]);
  runGit(projectDir, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
}

export async function createFixProject(projectDir: string, files: Record<string, string>): Promise<string> {
  await Bun.write(
    path.join(projectDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "bundler" },
      include: ["**/*.ts", "**/*.tsx"],
      exclude: ["*.config.ts"],
    }),
  );
  for (const [fileName, content] of Object.entries(files)) {
    await Bun.write(path.join(projectDir, fileName), content);
  }
  commitFixProject(projectDir);
  return path.join(projectDir, "tsconfig.json");
}
