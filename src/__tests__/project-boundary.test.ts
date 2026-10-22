import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";
import { fixProject } from "../fixProject";
import { commitFixProject } from "./helpers";

const SHARED_SOURCE = [
  'import { usedOutsideProject } from "../app/partial";',
  "export interface ISharedModel { used: string; unusedField?: string; }",
  "export const sharedUnused = 1;",
  'export function readShared(): string | number { return "shared"; }',
  "export const sharedUsed: ISharedModel = { used: String(usedOutsideProject) };",
  "",
].join("\n");

const SHARED_BARREL_SOURCE = 'export * from "../app/dead";\nexport { sharedUsed } from "./model";\n';

let repoDir: string;
let tsConfigPath: string;

beforeEach(async () => {
  const tempDir = path.join(import.meta.dir, "../../.tmp");
  await mkdir(tempDir, { recursive: true });
  repoDir = await mkdtemp(path.join(tempDir, "project-boundary-"));
  tsConfigPath = path.join(repoDir, "app/tsconfig.json");

  await Bun.write(
    tsConfigPath,
    JSON.stringify({ compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "bundler" } }),
  );
  await Bun.write(path.join(repoDir, "shared/model.ts"), SHARED_SOURCE);
  await Bun.write(path.join(repoDir, "shared/barrel.ts"), SHARED_BARREL_SOURCE);
  await Bun.write(path.join(repoDir, "app/dead.ts"), "export const dead = 1;\n");
  await Bun.write(
    path.join(repoDir, "app/partial.ts"),
    "export const appUsed = 1;\nexport const appUnused = 2;\nexport const usedOutsideProject = 3;\n",
  );
  await Bun.write(
    path.join(repoDir, "app/main.ts"),
    [
      'import { sharedUsed } from "../shared/barrel";',
      'import { readShared } from "../shared/model";',
      'import { appUsed } from "./partial";',
      "console.log(sharedUsed.used, readShared(), appUsed);",
      "",
    ].join("\n"),
  );
  commitFixProject(repoDir);
});

afterEach(async () => {
  await rm(repoDir, { recursive: true, force: true });
});

describe("project boundary", () => {
  test("reports only files that belong to the analyzed tsconfig", async () => {
    const results = await analyzeProject(tsConfigPath);

    expect(results.unusedFiles).toEqual(["dead.ts"]);
    expect(results.unusedExports.map((item) => `${item.filePath}:${item.exportName}`).toSorted()).toEqual([
      "dead.ts:dead",
      "partial.ts:appUnused",
    ]);
    expect(results.unusedProperties).toEqual([]);
    expect(results.neverReturnedTypes).toEqual([]);
  });

  test("fix never edits or deletes files outside the analyzed tsconfig", async () => {
    const results = await fixProject(tsConfigPath);

    expect(results.errors).toEqual([]);
    expect(results.deletedFiles).toBe(1);
    expect(results.fixedExports).toBe(1);
    expect(results.fixedProperties).toBe(0);
    expect(results.fixedNeverReturnedTypes).toBe(0);
    expect(await Bun.file(path.join(repoDir, "app/dead.ts")).exists()).toBe(false);
    expect(await Bun.file(path.join(repoDir, "shared/model.ts")).text()).toBe(SHARED_SOURCE);
    expect(await Bun.file(path.join(repoDir, "shared/barrel.ts")).text()).toBe(SHARED_BARREL_SOURCE);
  });
});
