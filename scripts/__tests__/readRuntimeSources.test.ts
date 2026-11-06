import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { readRuntimeSources } from "../readRuntimeSources.ts";

let projectDir = "";

beforeEach(async () => {
  const temporaryRoot = resolve(import.meta.dir, "../../.tmp");
  await mkdir(temporaryRoot, { recursive: true });
  projectDir = await mkdtemp(join(temporaryRoot, "coverage-inventory-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("readRuntimeSources", () => {
  test("finds executable sources regardless of filenames and excludes only erased source and tests", async () => {
    const files: Record<string, string> = {
      "src/types.ts": "export const value = 1;",
      "src/cli.ts": "console.log('entry point');",
      "src/constant.ts": "const unused = 1;",
      "src/dead.ts": "if (false) console.log('still executable source');",
      "src/expression.ts": "0;",
      "src/effect.ts": "import './types.ts';",
      "src/inlineType.ts": "import { type Shape } from './erased.ts';",
      "src/barrel.ts": "export { value } from './types.ts';",
      "src/enum.ts": "export enum Kind { One, Two }",
      "src/erased.ts": "export interface Shape { value: string } export type Alias = Shape;",
      "src/typeImport.ts": "import type { Shape } from './erased.ts'; export type Copy = Shape;",
      "src/typeValueImport.ts": "import type { value } from './types.ts'; export type Value = typeof value;",
      "src/valueTypeQuery.ts": "import { value } from './types.ts'; export type Value = typeof value;",
      "src/ambient.ts": "declare const ambient: string;",
      "src/empty.ts": "; export {};",
      "src/ambient.d.ts": "declare const value: string;",
      "src/ambient.d.mts": "declare const value: string;",
      "src/ambient.d.cts": "declare const value: string;",
      "src/__tests__/code.test.ts": "console.log('test');",
      "src/nested/__tests__/helpers.ts": "console.log('test helper');",
      "scripts/tool.ts": "console.log('tool');",
    };
    await Promise.all(Object.entries(files).map(([file, text]) => Bun.write(join(projectDir, file), text)));
    expect(await readRuntimeSources(projectDir)).toEqual(
      [
        "barrel.ts",
        "cli.ts",
        "constant.ts",
        "dead.ts",
        "effect.ts",
        "enum.ts",
        "expression.ts",
        "inlineType.ts",
        "types.ts",
        "valueTypeQuery.ts",
      ].map((file) => join(projectDir, "src", file)),
    );
  });

  test.each(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"])(
    "includes executable .%s source in nested directories",
    async (extension) => {
      const source = join(projectDir, `src/nested/module.${extension}`);
      await Bun.write(source, "console.log('runtime');");
      expect(await readRuntimeSources(projectDir)).toEqual([source]);
    },
  );

  test("preserves JSX evaluation in the runtime inventory", async () => {
    const source = join(projectDir, "src/view.tsx");
    await Bun.write(source, "export const view = <div />;");
    expect(await readRuntimeSources(projectDir)).toEqual([source]);
  });

  test("includes executable hidden files and directories", async () => {
    const sources = ["src/.hidden.ts", "src/.internal/main.ts", "src/visible.ts"].map((file) => join(projectDir, file));
    await Promise.all(sources.map((source) => Bun.write(source, "console.log('runtime');")));
    expect(await readRuntimeSources(projectDir)).toEqual(sources);
  });

  test.each([
    ["src", "target", "dir"],
    ["src/file.ts", "target/module.ts", "file"],
    ["src/nested", "target", "dir"],
    ["src/.hidden", "target", "dir"],
    ["src/broken.ts", "missing.ts", "file"],
  ] as const)(
    "rejects a symbolic link at %s instead of silently omitting executable source",
    async (source, target, kind) => {
      await Bun.write(join(projectDir, "target/module.ts"), "export const value = 1;");
      const link = join(projectDir, source);
      await mkdir(dirname(link), { recursive: true });
      await symlink(join(projectDir, target), link, kind);
      await expect(readRuntimeSources(projectDir)).rejects.toThrow(
        new Error(`Symbolic links are unsupported in the runtime source inventory: ${source}`),
      );
    },
  );

  test("fails when a source cannot be transpiled", async () => {
    await Bun.write(join(projectDir, "src/broken.ts"), "export const = ;");
    await expect(readRuntimeSources(projectDir)).rejects.toThrow(
      new Error("Cannot inspect runtime source: src/broken.ts"),
    );
  });

  test("does not invent coverage obligations outside the source directory", async () => {
    await Bun.write(join(projectDir, "scripts/tool.ts"), "console.log('tool');");
    expect(await readRuntimeSources(projectDir)).toEqual([]);
  });
});
