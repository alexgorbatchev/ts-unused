import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type { IUnusedConfig } from "../config";
import { fixProject } from "../fixProject";
import { createFixProject, runGit } from "./helpers";

let projectDir: string;

beforeEach(async () => {
  const tempDir = path.join(import.meta.dir, "../../.tmp");
  await mkdir(tempDir, { recursive: true });
  projectDir = await mkdtemp(path.join(tempDir, "fix-config-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("fixProject configuration", () => {
  const exportConfigs: IUnusedConfig[] = [
    { ignoreExports: ["unused"] },
    { ignoreFilePatterns: ["**/model.ts"] },
    { analyzeExports: false },
    { packageMode: true },
  ];

  test.each(exportConfigs)("preserves exports excluded by %j", async (config) => {
    const source = "export const unused = 1;\n";
    const tsConfigPath = await createFixProject(projectDir, {
      "model.ts": source,
      "package.json": JSON.stringify({ main: "./model.ts" }),
    });

    const results = await fixProject(tsConfigPath, undefined, { config });

    expect(results).toEqual({
      fixedExports: 0,
      fixedProperties: 0,
      fixedNeverReturnedTypes: 0,
      deletedFiles: 0,
      skippedFiles: [],
      errors: [],
    });
    expect(await Bun.file(path.join(projectDir, "model.ts")).text()).toBe(source);
  });

  const propertyConfigs: IUnusedConfig[] = [
    { analyzeProperties: false },
    { ignoreProperties: ["unused"] },
    { ignoreTypes: ["Model"] },
  ];

  test.each(propertyConfigs)("preserves properties excluded by %j", async (config) => {
    const source = "export interface Model { unused?: string; }\n";
    const tsConfigPath = await createFixProject(projectDir, {
      "model.ts": source,
      "consumer.ts": 'import type { Model } from "./model";\nconst model: Model = {};\nconsole.log(model);\n',
    });

    const results = await fixProject(tsConfigPath, undefined, { config });

    expect(results.fixedProperties).toBe(0);
    expect(results.skippedFiles).toEqual([]);
    expect(results.errors).toEqual([]);
    expect(await Bun.file(path.join(projectDir, "model.ts")).text()).toBe(source);
  });

  test("preserves return unions when that analysis is disabled", async () => {
    const source = 'export function read(): string | number { return "ok"; }\n';
    const tsConfigPath = await createFixProject(projectDir, {
      "model.ts": source,
      "consumer.ts": 'import { read } from "./model";\nconsole.log(read());\n',
    });

    const results = await fixProject(tsConfigPath, undefined, { config: { analyzeNeverReturnedTypes: false } });

    expect(results.fixedNeverReturnedTypes).toBe(0);
    expect(results.errors).toEqual([]);
    expect(await Bun.file(path.join(projectDir, "model.ts")).text()).toBe(source);
  });

  test("removes unused exports without deleting files when file detection is disabled", async () => {
    const tsConfigPath = await createFixProject(projectDir, { "model.ts": "export const unused = 1;\n" });

    const results = await fixProject(tsConfigPath, undefined, { config: { detectUnusedFiles: false } });

    expect(results.fixedExports).toBe(1);
    expect(results.deletedFiles).toBe(0);
    expect(results.errors).toEqual([]);
    expect(await Bun.file(path.join(projectDir, "model.ts")).text()).toBe("");
  });

  test("uses configured test-file patterns", async () => {
    const source = "export const unused = 1;\n";
    const tsConfigPath = await createFixProject(projectDir, { "model.custom.ts": source });

    const results = await fixProject(tsConfigPath, undefined, { config: { testFilePatterns: ["**/*.custom.ts"] } });

    expect(results.deletedFiles).toBe(0);
    expect(await Bun.file(path.join(projectDir, "model.custom.ts")).text()).toBe(source);
  });

  test("lets a custom detector override configured test-file patterns", async () => {
    const tsConfigPath = await createFixProject(projectDir, { "model.custom.ts": "export const unused = 1;\n" });

    const results = await fixProject(tsConfigPath, undefined, {
      config: { testFilePatterns: ["**/*.custom.ts"] },
      isTestFile: () => false,
    });

    expect(results.deletedFiles).toBe(1);
    expect(await Bun.file(path.join(projectDir, "model.custom.ts")).exists()).toBe(false);
  });

  test("accepts an existing custom detector function", async () => {
    const source = "export const unused = 1;\n";
    const tsConfigPath = await createFixProject(projectDir, { "model.ts": source });

    const results = await fixProject(tsConfigPath, undefined, () => true);

    expect(results.deletedFiles).toBe(0);
    expect(await Bun.file(path.join(projectDir, "model.ts")).text()).toBe(source);
  });

  test("still removes unused files with default settings", async () => {
    const tsConfigPath = await createFixProject(projectDir, { "model.ts": "export const unused = 1;\n" });

    const results = await fixProject(tsConfigPath);

    expect(results.deletedFiles).toBe(1);
    expect(await Bun.file(path.join(projectDir, "model.ts")).exists()).toBe(false);
  });
});

describe("fixProject Git safety", () => {
  test("preserves staged changes", async () => {
    const tsConfigPath = await createFixProject(projectDir, { "model.ts": "export const unused = 1;\n" });
    const source = "export const unused = 2;\n";
    await Bun.write(path.join(projectDir, "model.ts"), source);
    runGit(projectDir, ["add", "model.ts"]);

    const results = await fixProject(tsConfigPath, undefined, { config: { detectUnusedFiles: false } });

    expect(results.skippedFiles).toEqual(["model.ts"]);
    expect(results.deletedFiles).toBe(0);
    expect(await Bun.file(path.join(projectDir, "model.ts")).text()).toBe(source);
    expect(runGit(projectDir, ["show", ":model.ts"])).toBe(source);
  });

  test("preserves untracked files inside new directories", async () => {
    const tsConfigPath = await createFixProject(projectDir, { "clean.ts": "export const unused = 1;\n" });
    const source = "export const unused = 2;\n";
    await Bun.write(path.join(projectDir, "new/model.ts"), source);

    const results = await fixProject(tsConfigPath);

    expect(results.skippedFiles).toEqual(["new/model.ts"]);
    expect(results.deletedFiles).toBe(1);
    expect(await Bun.file(path.join(projectDir, "new/model.ts")).text()).toBe(source);
    expect(await Bun.file(path.join(projectDir, "clean.ts")).exists()).toBe(false);
  });

  test.each(["model with spaces.ts", "model -> target.ts", "model\nquoted.ts"])(
    "preserves renamed files with special characters: %j",
    async (fileName) => {
      const source = "export const unused = 1;\n";
      const tsConfigPath = await createFixProject(projectDir, { "original.ts": source, "z-last.ts": source });
      runGit(projectDir, ["mv", "original.ts", fileName]);
      const modifiedSource = "export const unused = 2;\n";
      await Bun.write(path.join(projectDir, "z-last.ts"), modifiedSource);

      const results = await fixProject(tsConfigPath);

      expect(results.skippedFiles.toSorted()).toEqual([fileName, "z-last.ts"].toSorted());
      expect(results.deletedFiles).toBe(0);
      expect(await Bun.file(path.join(projectDir, fileName)).text()).toBe(source);
      expect(await Bun.file(path.join(projectDir, "z-last.ts")).text()).toBe(modifiedSource);
    },
  );

  test("skips export, property, and return-type fixes without changing a dirty file", async () => {
    const source = [
      "export interface Model { unused?: string; }",
      "export const unused = 1;",
      'export function read(): string | number { return "ok"; }',
      "",
    ].join("\n");
    const tsConfigPath = await createFixProject(projectDir, {
      "model.ts": source,
      "consumer.ts":
        'import { read, type Model } from "./model";\nconst model: Model = {};\nconsole.log(read(), model);\n',
    });
    const modifiedSource = source + "// local work\n";
    await Bun.write(path.join(projectDir, "model.ts"), modifiedSource);

    const results = await fixProject(tsConfigPath);

    expect(results.fixedExports).toBe(0);
    expect(results.fixedProperties).toBe(0);
    expect(results.fixedNeverReturnedTypes).toBe(0);
    expect(results.skippedFiles).toEqual(["model.ts"]);
    expect(results.errors).toEqual([]);
    expect(await Bun.file(path.join(projectDir, "model.ts")).text()).toBe(modifiedSource);
  });

  test("preserves dirty re-export files while cleaning up deleted modules", async () => {
    const tsConfigPath = await createFixProject(projectDir, {
      "unused.ts": "export const unused = 1;\n",
      "barrel.ts": 'export * from "./unused";\nexport const own = 1;\n',
      "consumer.ts": 'import { own } from "./barrel";\nconsole.log(own);\n',
    });
    const modifiedSource = 'export * from "./unused";\nexport const own = 2;\n';
    await Bun.write(path.join(projectDir, "barrel.ts"), modifiedSource);

    const results = await fixProject(tsConfigPath);

    expect(results.deletedFiles).toBe(1);
    expect(await Bun.file(path.join(projectDir, "unused.ts")).exists()).toBe(false);
    expect(await Bun.file(path.join(projectDir, "barrel.ts")).text()).toBe(modifiedSource);
  });

  test("skips property-only fixes in dirty files", async () => {
    const tsConfigPath = await createFixProject(projectDir, {
      "model.ts": "export interface Model { unused?: string; }\n",
      "consumer.ts": 'import type { Model } from "./model";\nconst model: Model = {};\nconsole.log(model);\n',
    });
    const source = "export interface Model { unused?: string; }\n// local work\n";
    await Bun.write(path.join(projectDir, "model.ts"), source);

    const results = await fixProject(tsConfigPath);

    expect(results.fixedProperties).toBe(0);
    expect(results.skippedFiles).toEqual(["model.ts"]);
    expect(await Bun.file(path.join(projectDir, "model.ts")).text()).toBe(source);
  });

  test("stops before deleting files when Git status fails inside a repository", async () => {
    const source = "export const unused = 1;\n";
    const tsConfigPath = await createFixProject(projectDir, { "model.ts": source });
    await Bun.write(path.join(projectDir, ".git/index"), "corrupted index");

    await expect(fixProject(tsConfigPath)).rejects.toThrow();

    expect(await Bun.file(path.join(projectDir, "model.ts")).text()).toBe(source);
  });
});

describe("fixProject return types", () => {
  test.each([
    {
      name: "quoted discriminants containing union separators",
      source:
        'export function read(): { kind: "ok|ready"; value: string } | { kind: "error"; reason: string } { return { kind: "ok|ready", value: "ok" }; }\n',
      expected:
        'export function read(): { kind: "ok|ready"; value: string }  { return { kind: "ok|ready", value: "ok" }; }\n',
    },
    {
      name: "async inline objects with nested generic unions",
      source:
        'export async function read(): Promise<{ kind: "ok"; value: Array<string | number> } | { kind: "error"; reason: string }> { return { kind: "ok", value: [1] }; }\n',
      expected:
        'export async function read(): Promise<{ kind: "ok"; value: Array<string | number> } > { return { kind: "ok", value: [1] }; }\n',
    },
    {
      name: "multiple retained primitive branches",
      source: 'export function read(): string | number | boolean { if (Date.now() > 0) return "ok"; return 1; }\n',
      expected: 'export function read(): string | number { if (Date.now() > 0) return "ok"; return 1; }\n',
    },
  ])("removes unused branches and preserves $name", async ({ source, expected }) => {
    const tsConfigPath = await createFixProject(projectDir, { "model.ts": source });

    const results = await fixProject(tsConfigPath, undefined, {
      config: { analyzeExports: false, analyzeProperties: false },
    });

    expect(results.fixedNeverReturnedTypes).toBe(1);
    expect(results.errors).toEqual([]);
    expect(await Bun.file(path.join(projectDir, "model.ts")).text()).toBe(expected);
  });
});

describe("CLI fix configuration", () => {
  test.each([
    { configFile: "unused.config.ts", args: [] },
    { configFile: "custom.config.ts", args: ["--config", "custom.config.ts"] },
  ])("respects $configFile", async ({ configFile, args }) => {
    const tsConfigPath = await createFixProject(projectDir, {
      "model.ts": "export const keep = 1;\nexport const remove = 2;\n",
      [configFile]: 'export default { ignoreExports: ["keep"] };\n',
    });
    const cliPath = path.join(import.meta.dir, "../cli.ts");
    const check = Bun.spawnSync([process.execPath, cliPath, "check", tsConfigPath, ...args], {
      cwd: projectDir,
      stderr: "pipe",
    });
    expect(check.exitCode).toBe(1);
    expect(check.stderr.toString()).toBe("");

    const fix = Bun.spawnSync([process.execPath, cliPath, "fix", tsConfigPath, ...args], {
      cwd: projectDir,
      stderr: "pipe",
    });

    expect(fix.stderr.toString()).toBe("");
    expect(fix.exitCode).toBe(0);
    expect(await Bun.file(path.join(projectDir, "model.ts")).text()).toBe("export const keep = 1;\n");

    const recheck = Bun.spawnSync([process.execPath, cliPath, "check", tsConfigPath, ...args], {
      cwd: projectDir,
      stderr: "pipe",
    });
    expect(recheck.stderr.toString()).toBe("");
    expect(recheck.exitCode).toBe(0);
  });
});
