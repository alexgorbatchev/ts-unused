import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";
import { fixProject } from "../fixProject";
import { loadConfigSync } from "../loadConfig";

let packageDir: string;
let tsConfigPath: string;

beforeEach(async () => {
  const tempDir = path.join(import.meta.dir, "../../.tmp");
  await mkdir(tempDir, { recursive: true });
  packageDir = await mkdtemp(path.join(tempDir, "mapped-entry-points-"));
  tsConfigPath = path.join(packageDir, "tsconfig.json");
  await writeFiles({
    "package.json": JSON.stringify({ name: "fixture", type: "module", main: "./dist/renamed.js" }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true },
      include: ["src", "types.d.ts", "node_modules/vendor/index.ts"],
    }),
    "src/barrel.ts": 'export { createOptions as default } from "./api";\n',
    "src/api.ts":
      "interface Options { publicValue?: string; }\nexport function createOptions(): Options { return {}; }\n",
    "src/internal.ts": "export interface Options { internalValue?: number; }\nexport const unusedInternal = 1;\n",
  });
});

afterEach(async () => {
  await rm(packageDir, { recursive: true, force: true });
});

async function writeFiles(files: Record<string, string>): Promise<void> {
  for (const [fileName, content] of Object.entries(files)) {
    await Bun.write(path.join(packageDir, fileName), content);
  }
}

function analyzeMappings(packageEntryPointSources: Record<string, string>) {
  return analyzeProject(tsConfigPath, undefined, undefined, {
    config: { packageMode: true, packageEntryPointSources },
  });
}

describe("explicit package entrypoint sources", () => {
  test("resolves a renamed bundle without build output and preserves declaration identity", async () => {
    const result = await analyzeMappings({ "./dist/renamed.js": "src/barrel.ts" });

    expect(result.unusedExports.map((item) => `${item.filePath}:${item.exportName}`).toSorted()).toEqual([
      "src/internal.ts:Options",
      "src/internal.ts:unusedInternal",
    ]);
    expect(result.unusedProperties.map((item) => `${item.filePath}:${item.typeName}.${item.propertyName}`)).toEqual([
      "src/internal.ts:Options.internalValue",
    ]);
    expect(await Bun.file(path.join(packageDir, "dist/renamed.js")).exists()).toBe(false);
  });

  test("maps nested conditional JavaScript and declaration targets alongside conventional entries", async () => {
    await writeFiles({
      "package.json": JSON.stringify({
        name: "fixture",
        exports: {
          ".": { import: { types: "./types/api.d.mts", default: "./dist/renamed.mjs" } },
          "./secondary": [{ require: "./dist/secondary.cjs" }, "./dist/secondary.js"],
          "./ordinary": "./dist/ordinary.js",
        },
      }),
      "src/secondaryEntry.ts": "export const secondary = 2;\n",
      "src/ordinary.ts": "export const ordinary = 3;\n",
    });

    const result = await analyzeMappings({
      "./types/api.d.mts": "src/barrel.ts",
      "./dist/renamed.mjs": "src/barrel.ts",
      "./dist/secondary.cjs": "src/secondaryEntry.ts",
      "./dist/secondary.js": "src/secondaryEntry.ts",
    });

    expect(result.unusedExports.map((item) => item.exportName).toSorted()).toEqual(["Options", "unusedInternal"]);
  });

  test.each([{}, { rootDir: "src", outDir: "dist" }])(
    "prefers the explicit source over a same-name conventional or compiler output",
    async (compilerOptions) => {
      await writeFiles({
        "tsconfig.json": JSON.stringify({ compilerOptions, include: ["src"] }),
        "src/renamed.ts": "export const wrongEntry = 1;\n",
      });

      const result = await analyzeMappings({ "./dist/renamed.js": "src/barrel.ts" });

      expect(result.unusedExports.map((item) => item.exportName).toSorted()).toEqual([
        "Options",
        "unusedInternal",
        "wrongEntry",
      ]);
    },
  );

  test("normalizes equivalent target and source paths without duplicating the public boundary", async () => {
    const result = await analyzeMappings({
      "dist/renamed.js": "./src/../src/barrel.ts",
      "./dist/renamed.js": path.join(packageDir, "src/barrel.ts"),
    });

    expect(result.unusedExports.map((item) => item.exportName).toSorted()).toEqual(["Options", "unusedInternal"]);
  });

  test.each(["./dist/misspelled.js", "./dist/*.js", ".", "__proto__"])(
    "rejects undeclared target %s",
    async (target) => {
      await writeFiles({ "src/renamed.ts": "export const otherwiseResolved = 1;\n" });

      await expect(analyzeMappings({ [target]: "src/barrel.ts" })).rejects.toThrow(
        new Error(`Invalid packageEntryPointSources target '${target}': not an explicit entry target in package.json.`),
      );
    },
  );

  test.each(["src/missing.ts", "excluded.ts", "types.d.ts", "node_modules/vendor/index.ts"])(
    "rejects ineligible source %s even when a conventional source resolves",
    async (source) => {
      await writeFiles({
        "src/renamed.ts": 'export { excluded } from "../excluded";\n',
        "excluded.ts": "export const excluded = 1;\n",
        "types.d.ts": "export declare const declared: number;\n",
        "node_modules/vendor/index.ts": "export const dependency = 1;\n",
      });

      await expect(analyzeMappings({ "./dist/renamed.js": source })).rejects.toThrow(
        new Error(
          `Invalid packageEntryPointSources mapping './dist/renamed.js': '${source}' must be a non-declaration source file included by the analyzed tsconfig, outside node_modules.`,
        ),
      );
    },
  );

  test("rejects conflicting mappings for the same normalized target", async () => {
    await expect(
      analyzeMappings({ "./dist/renamed.js": "src/barrel.ts", "dist/renamed.js": "src/internal.ts" }),
    ).rejects.toThrow(new Error("Conflicting packageEntryPointSources mappings for target 'dist/renamed.js'."));
  });

  test("invalid mappings stop fix before any files change", async () => {
    const files = await readdir(path.join(packageDir, "src"));
    const before = await Promise.all(files.map((file) => Bun.file(path.join(packageDir, "src", file)).text()));

    await expect(
      fixProject(tsConfigPath, undefined, {
        config: { packageMode: true, packageEntryPointSources: { "./dist/renamed.js": "excluded.ts" } },
      }),
    ).rejects.toThrow(
      new Error(
        "Invalid packageEntryPointSources mapping './dist/renamed.js': 'excluded.ts' must be a non-declaration source file included by the analyzed tsconfig, outside node_modules.",
      ),
    );

    expect(await readdir(path.join(packageDir, "src"))).toEqual(files);
    expect(await Promise.all(files.map((file) => Bun.file(path.join(packageDir, "src", file)).text()))).toEqual(before);
  });
});

describe("mapping configuration", () => {
  test.each(["null", "[]", "42", "'src/barrel.ts'", "new Map()", "new Date()"])(
    "rejects a non-record mapping: %s",
    async (value) => {
      await writeFiles({
        "unused.config.ts": `export default { packageMode: true, packageEntryPointSources: ${value} };\n`,
      });

      expect(() => loadConfigSync(packageDir)).toThrow(
        new Error(
          `Failed to load config from ${path.join(packageDir, "unused.config.ts")}: packageEntryPointSources must be a record of package targets to source paths.`,
        ),
      );
    },
  );

  test.each(["null", "[]", "42", "''", "' '"])("rejects a non-path source: %s", async (value) => {
    await writeFiles({
      "unused.config.ts": `export default { packageMode: true, packageEntryPointSources: { './dist/renamed.js': ${value} } };\n`,
    });

    expect(() => loadConfigSync(packageDir)).toThrow(
      new Error(
        `Failed to load config from ${path.join(packageDir, "unused.config.ts")}: packageEntryPointSources mapping './dist/renamed.js' must have a non-empty target and source path.`,
      ),
    );
  });

  test("rejects an empty target", async () => {
    await expect(analyzeMappings({ "": "src/barrel.ts" })).rejects.toThrow(
      new Error("packageEntryPointSources mapping '' must have a non-empty target and source path."),
    );
  });

  test("rejects mappings outside package mode", async () => {
    await expect(
      analyzeProject(tsConfigPath, undefined, undefined, {
        config: { packageEntryPointSources: { "./dist/renamed.js": "src/barrel.ts" } },
      }),
    ).rejects.toThrow(new Error("packageEntryPointSources requires packageMode: true."));
  });

  test.each([
    { configFile: "unused.config.ts", args: [] },
    { configFile: "config/custom.ts", args: ["--config", "../config/custom.ts"] },
  ])("CLI loads $configFile with paths relative to package.json", async ({ configFile, args }) => {
    await writeFiles({
      "src/internal.ts": "export {};\n",
      [configFile]: `export default { packageMode: true, packageEntryPointSources: { './dist/renamed.js': 'src/barrel.ts' } };\n`,
    });

    const runnerDir = path.join(packageDir, "runner");
    await mkdir(runnerDir);
    const result = Bun.spawnSync(
      [process.execPath, path.join(import.meta.dir, "../cli.ts"), "check", tsConfigPath, ...args],
      {
        cwd: runnerDir,
        env: { ...process.env, AGENT: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
