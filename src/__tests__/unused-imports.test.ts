import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";
import { fixProject } from "../fixProject";
import { commitFixProject, createFixProject } from "./helpers";

let projectDir: string;

beforeEach(async () => {
  const tempDir = path.join(import.meta.dir, "../../.tmp");
  await mkdir(tempDir, { recursive: true });
  projectDir = await mkdtemp(path.join(tempDir, "unused-imports-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

async function typecheck(): Promise<string> {
  const result = Bun.spawnSync(
    ["bun", "run", "tsgo", "--noEmit", "--project", path.join(projectDir, "tsconfig.json")],
    { cwd: path.join(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" },
  );
  return result.stdout.toString() + result.stderr.toString();
}

const VALUES_FILE = [
  "export function unusedNamed(): number { return 1; }",
  "export function unusedAliased(): number { return 2; }",
  "export interface UnusedType { kind: string; }",
  "export interface UnusedInlineType { kind: string; }",
  "export function usedValue(): number { return 3; }",
  "export function usedAliased(): number { return 4; }",
  "export interface UsedType { kind: string; }",
  'export const usedInTypeof = { kind: "a" };',
  "export function usedDecorator<T>(target: T, context: unknown): T { console.log(context); return target; }",
  "export function testImported(): number { return 5; }",
  "export function testUsed(): number { return 6; }",
  "",
].join("\n");

const CONSUMER_FILE = [
  "import {",
  "  unusedNamed,",
  "  unusedAliased as renamedUnused,",
  "  usedValue,",
  "  usedAliased as renamedUsed,",
  "  usedInTypeof,",
  "  usedDecorator,",
  '} from "./values";',
  'import type { UnusedType, UsedType } from "./values";',
  'import { type UnusedInlineType } from "./values";',
  'import unusedDefault from "./default-unused";',
  'import usedDefault from "./default-used";',
  'import * as usedNamespace from "./namespace";',
  'import * as unusedNamespace from "./unused-namespace";',
  'import * as registry from "./registry";',
  'import "./side-effect";',
  "console.log(Object.keys(registry));",
  'const shape: UsedType = { kind: "b" };',
  "type Inferred = typeof usedInTypeof;",
  'const inferred: Inferred = { kind: "c" };',
  "@usedDecorator",
  "class Decorated {}",
  "console.log(usedValue(), renamedUsed(), usedDefault(), usedNamespace.viaNamespace(), shape, inferred, Decorated);",
  "",
].join("\n");

const ANALYSIS_FILES: Record<string, string> = {
  "values.ts": VALUES_FILE,
  "default-unused.ts": "export default function unusedDefault(): number { return 1; }\n",
  "default-used.ts": "export default function usedDefault(): number { return 2; }\n",
  "namespace.ts":
    "export function viaNamespace(): number { return 1; }\nexport function notViaNamespace(): number { return 2; }\n",
  "unused-namespace.ts": "export function onlyNamespaceImported(): number { return 1; }\n",
  "side-effect.ts": 'export function sideExport(): number { return 1; }\nconsole.log("loaded");\n',
  "widget.tsx": "export function Widget(): null { return null; }\n",
  "consumer.ts": CONSUMER_FILE,
  "page.tsx": 'import { Widget } from "./widget";\nconst element = <Widget />;\nconsole.log(element);\n',
  "registry.ts": "export function first(): number { return 1; }\nexport function second(): number { return 2; }\n",
  "test-registry.ts": "export function fixture(): number { return 1; }\n",
  "values.test.ts":
    'import { testImported, testUsed } from "./values";\n' +
    'import * as testRegistry from "./test-registry";\n' +
    "console.log(testUsed(), testRegistry);\n",
};

describe("unused imports", () => {
  test("do not count as usage of the imported export", async () => {
    const tsConfigPath = await createFixProject(projectDir, ANALYSIS_FILES);

    const results = await analyzeProject(tsConfigPath);

    expect(
      results.unusedExports.map((item) => `${item.filePath}:${item.exportName}:${item.severity}`).toSorted(),
    ).toEqual([
      "default-unused.ts:default:error",
      "namespace.ts:notViaNamespace:error",
      "side-effect.ts:sideExport:error",
      "test-registry.ts:fixture:info",
      "unused-namespace.ts:onlyNamespaceImported:error",
      "values.ts:UnusedInlineType:error",
      "values.ts:UnusedType:error",
      "values.ts:testImported:error",
      "values.ts:testUsed:info",
      "values.ts:unusedAliased:error",
      "values.ts:unusedNamed:error",
    ]);
  });

  test("leave files that are only imported for side effects out of the completely unused files", async () => {
    const tsConfigPath = await createFixProject(projectDir, ANALYSIS_FILES);

    const results = await analyzeProject(tsConfigPath);

    expect(results.unusedFiles.toSorted()).toEqual(["default-unused.ts", "unused-namespace.ts"]);
  });
});

describe("fixing exports that are only imported", () => {
  test("removes the declarations together with the import specifiers that bind them", async () => {
    const tsConfigPath = await createFixProject(projectDir, {
      "source.ts":
        "export function dead(): number { return 1; }\n" +
        "export function alsoDead(): number { return 2; }\n" +
        "export default function deadDefault(): number { return 3; }\n" +
        "export function kept(): number { return 4; }\n",
      "consumer.ts":
        'import deadDefault, { dead, kept } from "./source";\n' +
        'import { alsoDead as renamed } from "./source";\n' +
        "console.log(kept());\n",
    });

    const results = await fixProject(tsConfigPath);

    expect(results.errors).toEqual([]);
    expect(results.fixedExports).toBe(3);
    expect(await Bun.file(path.join(projectDir, "source.ts")).text()).toBe(
      "export function kept(): number { return 4; }\n",
    );
    expect(await Bun.file(path.join(projectDir, "consumer.ts")).text()).toBe(
      'import { kept } from "./source";\nconsole.log(kept());\n',
    );
    expect(await typecheck()).toBe("");
  });

  test("removes named and namespace imports of a deleted file", async () => {
    const tsConfigPath = await createFixProject(projectDir, {
      "dead.ts": "export function dead(): number { return 1; }\nexport function alsoDead(): number { return 2; }\n",
      "consumer.ts":
        'import { dead } from "./dead";\n' +
        'import * as deadNamespace from "./dead";\n' +
        'import { used } from "./used";\n' +
        "console.log(used);\n",
      "used.ts": "export const used = 1;\n",
    });

    const results = await fixProject(tsConfigPath);

    expect(results.errors).toEqual([]);
    expect(results.deletedFiles).toBe(1);
    expect(await Bun.file(path.join(projectDir, "dead.ts")).exists()).toBe(false);
    expect(await Bun.file(path.join(projectDir, "consumer.ts")).text()).toBe(
      'import { used } from "./used";\nconsole.log(used);\n',
    );
    expect(await typecheck()).toBe("");
  });

  test("keeps a file imported for side effects and removes only its unused exports", async () => {
    const tsConfigPath = await createFixProject(projectDir, {
      "setup.ts": 'export function unusedSetup(): number { return 1; }\nconsole.log("loaded");\n',
      "main.ts": 'import "./setup";\n',
    });

    const results = await fixProject(tsConfigPath);

    expect(results.errors).toEqual([]);
    expect(results.deletedFiles).toBe(0);
    expect(await Bun.file(path.join(projectDir, "setup.ts")).text()).toBe('console.log("loaded");\n');
    expect(await Bun.file(path.join(projectDir, "main.ts")).text()).toBe('import "./setup";\n');
    expect(await typecheck()).toBe("");
  });

  test("removes an unreferenced namespace import of a file it removes every export from", async () => {
    const tsConfigPath = await createFixProject(projectDir, {
      "setup.ts": 'export function unusedSetup(): number { return 1; }\nconsole.log("loaded");\n',
      "main.ts": 'import "./setup";\nimport * as setup from "./setup";\n',
    });

    const results = await fixProject(tsConfigPath);

    expect(results.errors).toEqual([]);
    expect(results.fixedExports).toBe(1);
    expect(await Bun.file(path.join(projectDir, "setup.ts")).text()).toBe('console.log("loaded");\n');
    expect(await Bun.file(path.join(projectDir, "main.ts")).text()).toBe('import "./setup";\n');
    expect(await typecheck()).toBe("");
  });

  test("keeps exports and files named by imports in files with local git changes", async () => {
    const sourceFile = "export function dead(): number { return 1; }\nexport const kept = 1;\n";
    const deadFile = "export function deadFile(): number { return 1; }\n";
    const tsConfigPath = await createFixProject(projectDir, {
      "source.ts": sourceFile,
      "dead-file.ts": deadFile,
      "consumer.ts": 'import { kept } from "./source";\nconsole.log(kept);\n',
      "dirty.ts": 'import { dead } from "./source";\nimport * as deadNamespace from "./dead-file";\n',
    });
    await Bun.write(
      path.join(projectDir, "dirty.ts"),
      'import { dead } from "./source";\nimport * as deadNamespace from "./dead-file";\nexport {};\n',
    );
    const messages: string[] = [];

    const results = await fixProject(tsConfigPath, (message) => messages.push(message));

    expect(results.errors).toEqual([]);
    expect(results.fixedExports).toBe(0);
    expect(results.deletedFiles).toBe(0);
    expect(results.skippedFiles).toEqual(["dirty.ts"]);
    expect(messages.filter((message) => message.startsWith("Skipped:")).toSorted()).toEqual([
      "Skipped: dead-file.ts (named in dirty.ts, which has local git changes)",
      "Skipped: source.ts:dead (named in dirty.ts, which has local git changes)",
    ]);
    expect(await Bun.file(path.join(projectDir, "source.ts")).text()).toBe(sourceFile);
    expect(await Bun.file(path.join(projectDir, "dead-file.ts")).text()).toBe(deadFile);
    expect(await typecheck()).toBe("");
  });

  test("keeps exports named by imports in files outside the analyzed tsconfig", async () => {
    const sourceFile = "export function dead(): number { return 1; }\nexport const kept = 1;\n";
    await createFixProject(projectDir, {
      "app/source.ts": sourceFile,
      "app/main.ts":
        'import { kept } from "./source";\nimport { shared } from "../shared/consumer";\nconsole.log(kept, shared);\n',
      "shared/consumer.ts": 'import { dead } from "../app/source";\nexport const shared = 1;\n',
    });
    const tsConfigPath = path.join(projectDir, "app/tsconfig.json");
    await Bun.write(
      tsConfigPath,
      JSON.stringify({ compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "bundler" } }),
    );
    commitFixProject(projectDir);
    const messages: string[] = [];

    const results = await fixProject(tsConfigPath, (message) => messages.push(message));

    expect(results.errors).toEqual([]);
    expect(results.fixedExports).toBe(0);
    expect(messages).toContain(
      "Skipped: source.ts:dead (named in ../shared/consumer.ts, outside the analyzed tsconfig)",
    );
    expect(await Bun.file(path.join(projectDir, "app/source.ts")).text()).toBe(sourceFile);
  });
});
