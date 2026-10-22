import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";

let packageDir: string;

beforeEach(async () => {
  const tempDir = path.join(import.meta.dir, "../../.tmp");
  await mkdir(tempDir, { recursive: true });
  packageDir = await mkdtemp(path.join(tempDir, "package-entry-points-"));
});

afterEach(async () => {
  await rm(packageDir, { recursive: true, force: true });
});

function json(value: object): string {
  return JSON.stringify(value, null, 2);
}

async function writeFixture(files: Record<string, string>): Promise<string> {
  for (const [fileName, content] of Object.entries(files)) {
    await Bun.write(path.join(packageDir, fileName), content);
  }
  return path.join(packageDir, "tsconfig.json");
}

async function findUnusedExports(tsConfigPath: string, packageMode: boolean): Promise<string[]> {
  const results = await analyzeProject(tsConfigPath, undefined, undefined, { config: { packageMode } });
  return results.unusedExports.map((item) => `${item.filePath}:${item.exportName}`).toSorted();
}

function createLibrarySources(sourceDir: string, extension = "ts"): Record<string, string> {
  return {
    [`${sourceDir}/index.${extension}`]: 'export * from "./utils";\n',
    [`${sourceDir}/utils/index.ts`]: 'export * from "./format";\n',
    [`${sourceDir}/utils/format.ts`]: "export function formatName(name: string): string { return name.trim(); }\n",
    [`${sourceDir}/internal.ts`]: "export function internalHelper(): number { return 1; }\n",
  };
}

const COMPILER_OPTIONS = { target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true };

describe("package entry points resolved through the tsconfig build layout", () => {
  test("maps outDir entries to an explicit rootDir that is not src", async () => {
    const tsConfigPath = await writeFixture({
      "package.json": json({ name: "fixture", type: "module", main: "./dist/index.js", types: "./dist/index.d.ts" }),
      "tsconfig.json": json({
        compilerOptions: { ...COMPILER_OPTIONS, rootDir: "lib", outDir: "dist" },
        include: ["lib"],
      }),
      ...createLibrarySources("lib"),
    });

    expect(await findUnusedExports(tsConfigPath, true)).toEqual(["lib/internal.ts:internalHelper"]);
  });

  test("maps entries to .tsx sources", async () => {
    const tsConfigPath = await writeFixture({
      "package.json": json({ name: "fixture", type: "module", exports: { ".": "./dist/index.js" } }),
      "tsconfig.json": json({
        compilerOptions: { ...COMPILER_OPTIONS, jsx: "react-jsx", rootDir: "src", outDir: "dist" },
        include: ["src"],
      }),
      ...createLibrarySources("src", "tsx"),
    });

    expect(await findUnusedExports(tsConfigPath, true)).toEqual(["src/internal.ts:internalHelper"]);
  });

  test("maps entries emitted under the tsconfig directory when rootDir is omitted", async () => {
    const tsConfigPath = await writeFixture({
      "package.json": json({ name: "fixture", type: "module", main: "./dist/src/index.js" }),
      "tsconfig.json": json({ compilerOptions: { ...COMPILER_OPTIONS, outDir: "dist" }, include: ["src"] }),
      ...createLibrarySources("src"),
    });

    expect(await findUnusedExports(tsConfigPath, true)).toEqual(["src/internal.ts:internalHelper"]);
  });

  test("maps entries emitted under the common source directory when rootDir is omitted", async () => {
    const tsConfigPath = await writeFixture({
      "package.json": json({ name: "fixture", type: "module", main: "./dist/index.js" }),
      "tsconfig.json": json({ compilerOptions: { ...COMPILER_OPTIONS, outDir: "dist" }, include: ["source"] }),
      ...createLibrarySources("source"),
    });

    expect(await findUnusedExports(tsConfigPath, true)).toEqual(["source/internal.ts:internalHelper"]);
  });

  test("maps nested export conditions through outDir and declarationDir", async () => {
    const tsConfigPath = await writeFixture({
      "package.json": json({
        name: "fixture",
        type: "module",
        exports: {
          ".": { import: { types: "./build/types/index.d.ts", default: "./build/esm/index.js" } },
          "./internal": [{ types: "./build/types/internal.d.ts" }, "./build/esm/internal.js"],
          "./styles.css": "./build/styles.css",
        },
      }),
      "tsconfig.json": json({
        compilerOptions: {
          ...COMPILER_OPTIONS,
          rootDir: "lib",
          outDir: "build/esm",
          declaration: true,
          declarationDir: "build/types",
        },
        include: ["lib"],
      }),
      ...createLibrarySources("lib"),
    });

    expect(await findUnusedExports(tsConfigPath, true)).toEqual([]);
  });

  test("falls back to the conventional build-to-src mapping for bundler output", async () => {
    const tsConfigPath = await writeFixture({
      "package.json": json({
        name: "fixture",
        type: "module",
        main: "./dist/index.cjs",
        module: "./dist/index.js",
        exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js", require: "./dist/index.cjs" } },
      }),
      "tsconfig.json": json({ compilerOptions: { ...COMPILER_OPTIONS, outDir: "./dist" }, include: ["./**/*.ts"] }),
      "vite.config.ts": "export default {};\n",
      ...createLibrarySources("src"),
    });

    expect(await findUnusedExports(tsConfigPath, true)).toEqual(["src/internal.ts:internalHelper"]);
  });

  test("uses entries that point directly at source files", async () => {
    const tsConfigPath = await writeFixture({
      "package.json": json({ name: "fixture", type: "module", exports: { ".": "./src/index.ts" } }),
      "tsconfig.json": json({ compilerOptions: COMPILER_OPTIONS, include: ["src"] }),
      ...createLibrarySources("src"),
    });

    expect(await findUnusedExports(tsConfigPath, true)).toEqual(["src/internal.ts:internalHelper"]);
  });

  test("treats aliased re-exports as public and leaves default exports hidden by export * unused", async () => {
    const tsConfigPath = await writeFixture({
      "package.json": json({ name: "fixture", type: "module", main: "./dist/index.js" }),
      "tsconfig.json": json({ compilerOptions: { ...COMPILER_OPTIONS, outDir: "dist" }, include: ["src"] }),
      "src/index.ts": 'export { formatName as format } from "./format";\nexport * from "./defaults";\n',
      "src/format.ts": "export function formatName(name: string): string { return name.trim(); }\n",
      "src/defaults.ts": "export const named = 1;\nexport default function hiddenDefault(): number { return 2; }\n",
    });

    expect(await findUnusedExports(tsConfigPath, true)).toEqual(["src/defaults.ts:default"]);
  });

  test("treats members of namespace re-exports as public", async () => {
    const tsConfigPath = await writeFixture({
      "package.json": json({ name: "fixture", type: "module", main: "./dist/index.js" }),
      "tsconfig.json": json({ compilerOptions: { ...COMPILER_OPTIONS, outDir: "dist" }, include: ["src"] }),
      ...createLibrarySources("src"),
      "src/index.ts": 'export * as formatting from "./formatting";\n',
      "src/formatting.ts": 'export * from "./utils";\n',
    });

    expect(await findUnusedExports(tsConfigPath, true)).toEqual(["src/internal.ts:internalHelper"]);
  });

  test("fails when no package entry point resolves to a project source file", async () => {
    const tsConfigPath = await writeFixture({
      "package.json": json({ name: "fixture", type: "module", main: "./dist/missing.js" }),
      "tsconfig.json": json({ compilerOptions: { ...COMPILER_OPTIONS, outDir: "dist" }, include: ["src"] }),
      ...createLibrarySources("src"),
    });

    await expect(findUnusedExports(tsConfigPath, true)).rejects.toThrow(
      "Package mode is enabled but no package.json entry point resolves to a project source file: ./dist/missing.js",
    );
  });
});

describe("export * re-exports outside package mode", () => {
  test("do not count as usage on their own", async () => {
    const tsConfigPath = await writeFixture({
      "tsconfig.json": json({ compilerOptions: COMPILER_OPTIONS, include: ["src"] }),
      ...createLibrarySources("src"),
    });

    expect(await findUnusedExports(tsConfigPath, false)).toEqual([
      "src/internal.ts:internalHelper",
      "src/utils/format.ts:formatName",
    ]);
  });

  test("count usage when a consumer imports through the export * chain", async () => {
    const tsConfigPath = await writeFixture({
      "tsconfig.json": json({ compilerOptions: COMPILER_OPTIONS, include: ["src"] }),
      "src/consumer.ts": 'import { formatName } from "./index";\nconsole.log(formatName(" name "));\n',
      ...createLibrarySources("src"),
    });

    expect(await findUnusedExports(tsConfigPath, false)).toEqual(["src/internal.ts:internalHelper"]);
  });
});
