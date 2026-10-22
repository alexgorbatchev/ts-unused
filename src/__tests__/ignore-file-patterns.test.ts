import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";
import { fixProject } from "../fixProject";
import type { IAnalysisResults } from "../types";
import { commitFixProject } from "./helpers";

const MODEL_SOURCE = [
  "export type Settings = { name: string };",
  "export const usedByGenerated = 1;",
  "export const reexportedByGenerated = 2;",
  "",
].join("\n");

const CLIENT_SOURCE = [
  'import { usedByGenerated } from "../src/model";',
  "export interface IGeneratedModel { unusedField: string; }",
  'export function generatedResult(): string | number { return "result"; }',
  "export type GeneratedSettings = { name: string };",
  "export const generatedValue = usedByGenerated;",
  "",
].join("\n");

const BARREL_SOURCE = 'export { reexportedByGenerated } from "../src/model";\n';

let repoDir: string;
let projectDir: string;
let tsConfigPath: string;

function summarize(results: IAnalysisResults): Record<string, string[]> {
  return {
    unusedFiles: results.unusedFiles.toSorted(),
    unusedExports: results.unusedExports.map((item) => `${item.filePath}:${item.exportName}`).toSorted(),
    unusedProperties: results.unusedProperties
      .map((item) => `${item.filePath}:${item.typeName}.${item.propertyName}`)
      .toSorted(),
    neverReturnedTypes: (results.neverReturnedTypes ?? [])
      .map((item) => `${item.filePath}:${item.functionName}:${item.neverReturnedType}`)
      .toSorted(),
    duplicateTypes: (results.duplicateTypes ?? [])
      .map((item) => `${item.filePath}:${item.typeName}=${item.duplicateOf.filePath}:${item.duplicateOf.typeName}`)
      .toSorted(),
  };
}

beforeEach(async () => {
  const tempDir = path.join(import.meta.dir, "../../.tmp");
  await mkdir(tempDir, { recursive: true });
  repoDir = await mkdtemp(path.join(tempDir, "ignore-file-patterns-"));
  projectDir = path.join(repoDir, "generated/project");
  tsConfigPath = path.join(projectDir, "tsconfig.json");

  await Bun.write(
    tsConfigPath,
    JSON.stringify({
      compilerOptions: { strict: true, target: "ES2020", module: "ESNext", moduleResolution: "bundler" },
    }),
  );
  await Bun.write(path.join(projectDir, "src/model.ts"), MODEL_SOURCE);
  await Bun.write(
    path.join(projectDir, "src/main.ts"),
    'import type { Settings } from "./model";\nconst settings: Settings = { name: "main" };\nconsole.log(settings.name);\n',
  );
  await Bun.write(path.join(projectDir, "generated/client.ts"), CLIENT_SOURCE);
  await Bun.write(path.join(projectDir, "generated/barrel.ts"), BARREL_SOURCE);
  commitFixProject(repoDir);
});

afterEach(async () => {
  await rm(repoDir, { recursive: true, force: true });
});

describe("ignoreFilePatterns", () => {
  test("reports findings in every analysis when no file is ignored", async () => {
    const results = await analyzeProject(tsConfigPath);

    expect(summarize(results)).toEqual({
      unusedFiles: ["generated/client.ts"],
      unusedExports: [
        "generated/client.ts:GeneratedSettings",
        "generated/client.ts:IGeneratedModel",
        "generated/client.ts:generatedResult",
        "generated/client.ts:generatedValue",
        "src/model.ts:reexportedByGenerated",
      ],
      unusedProperties: [
        "generated/client.ts:GeneratedSettings.name",
        "generated/client.ts:IGeneratedModel.unusedField",
      ],
      neverReturnedTypes: ["generated/client.ts:generatedResult:number"],
      duplicateTypes: ["src/model.ts:Settings=generated/client.ts:GeneratedSettings"],
    });
  });

  test.each([["generated/**"], ["**/generated/**"]])(
    "excludes files matching %p relative to the tsconfig directory from every analysis",
    async (pattern) => {
      const results = await analyzeProject(tsConfigPath, undefined, undefined, {
        config: { ignoreFilePatterns: [pattern] },
      });

      expect(summarize(results)).toEqual({
        unusedFiles: [],
        unusedExports: ["src/model.ts:reexportedByGenerated"],
        unusedProperties: [],
        neverReturnedTypes: [],
        duplicateTypes: [],
      });
    },
  );

  test("excludes ignored files from duplicate comparison when checking a single file", async () => {
    const results = await analyzeProject(tsConfigPath, undefined, path.join(projectDir, "src/model.ts"), {
      config: { ignoreFilePatterns: ["generated/**"] },
    });

    expect(results.duplicateTypes).toEqual([]);
  });

  test("fix never edits or deletes ignored files and keeps the exports they name", async () => {
    const results = await fixProject(tsConfigPath, undefined, { config: { ignoreFilePatterns: ["generated/**"] } });

    expect(results).toEqual({
      fixedExports: 0,
      fixedProperties: 0,
      fixedNeverReturnedTypes: 0,
      deletedFiles: 0,
      skippedFiles: [],
      errors: [],
    });
    expect(await Bun.file(path.join(projectDir, "src/model.ts")).text()).toBe(MODEL_SOURCE);
    expect(await Bun.file(path.join(projectDir, "generated/client.ts")).text()).toBe(CLIENT_SOURCE);
    expect(await Bun.file(path.join(projectDir, "generated/barrel.ts")).text()).toBe(BARREL_SOURCE);
  });

  test("fix does not delete an ignored file that only re-exports a deleted file", async () => {
    await Bun.write(path.join(projectDir, "src/dead.ts"), "export const dead = 1;\n");
    await Bun.write(path.join(projectDir, "generated/dead-barrel.ts"), 'export * from "../src/dead";\n');
    commitFixProject(repoDir);

    const results = await fixProject(tsConfigPath, undefined, { config: { ignoreFilePatterns: ["generated/**"] } });

    expect(results.errors).toEqual([]);
    expect(results.deletedFiles).toBe(1);
    expect(await Bun.file(path.join(projectDir, "src/dead.ts")).exists()).toBe(false);
    expect(await Bun.file(path.join(projectDir, "generated/dead-barrel.ts")).text()).toBe(
      'export * from "../src/dead";\n',
    );
  });
});
