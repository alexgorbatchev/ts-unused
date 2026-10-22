import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";
import { fixProject } from "../fixProject";
import { createFixProject } from "./helpers";

let projectDir: string;

beforeEach(async () => {
  const tempDir = path.join(import.meta.dir, "../../.tmp");
  await mkdir(tempDir, { recursive: true });
  projectDir = await mkdtemp(path.join(tempDir, "named-re-exports-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

const SOURCE_FILE =
  "export function plain(): number { return 1; }\n" +
  "export function aliased(): number { return 2; }\n" +
  "export type Shape = { kind: string };\n" +
  "export function forwarded(): number { return 3; }\n" +
  "export function kept(): number { return 4; }\n";

async function findUnusedExports(tsConfigPath: string, packageMode = false): Promise<string[]> {
  const results = await analyzeProject(tsConfigPath, undefined, undefined, { config: { packageMode } });
  return results.unusedExports.map((item) => `${item.filePath}:${item.exportName}`).toSorted();
}

async function typecheck(): Promise<string> {
  const result = Bun.spawnSync(
    ["bun", "run", "tsgo", "--noEmit", "--project", path.join(projectDir, "tsconfig.json")],
    { cwd: path.join(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" },
  );
  return result.stdout.toString() + result.stderr.toString();
}

describe("named re-exports outside package mode", () => {
  test("do not count as usage on their own", async () => {
    const tsConfigPath = await createFixProject(projectDir, {
      "source.ts": SOURCE_FILE,
      "barrel.ts":
        'export { plain } from "./source";\n' +
        'export { aliased as renamed } from "./source";\n' +
        'export type { Shape } from "./source";\n' +
        'import { forwarded } from "./source";\n' +
        "export { forwarded };\n" +
        'export { kept } from "./source";\n',
      "consumer.ts": 'import { kept } from "./barrel";\nconsole.log(kept());\n',
    });

    expect(await findUnusedExports(tsConfigPath)).toEqual([
      "source.ts:Shape",
      "source.ts:aliased",
      "source.ts:forwarded",
      "source.ts:plain",
    ]);
  });

  test("do not count a local export list entry as usage", async () => {
    const tsConfigPath = await createFixProject(projectDir, {
      "local.ts": "function local(): number { return 1; }\nexport { local, local as alias };\n",
    });

    expect(await findUnusedExports(tsConfigPath)).toEqual(["local.ts:alias", "local.ts:local"]);
  });

  test("count usage of the re-exported name through aliased barrel chains", async () => {
    const tsConfigPath = await createFixProject(projectDir, {
      "source.ts": "export function aliased(): number { return 2; }\n",
      "barrel.ts": 'export { aliased as renamed } from "./source";\n',
      "index.ts": 'export { renamed as twice } from "./barrel";\n',
      "consumer.ts": 'import { twice } from "./index";\nconsole.log(twice());\n',
    });

    expect(await findUnusedExports(tsConfigPath)).toEqual([]);
  });

  test("count usage of an imported name that is also re-exported", async () => {
    const tsConfigPath = await createFixProject(projectDir, {
      "source.ts": "export function forwarded(): number { return 3; }\n",
      "barrel.ts": 'import { forwarded } from "./source";\nexport { forwarded };\nconsole.log(forwarded());\n',
    });

    expect(await findUnusedExports(tsConfigPath)).toEqual([]);
  });
});

describe("named re-exports in package mode", () => {
  test("count as public only when the re-export reaches an entry point", async () => {
    const tsConfigPath = await createFixProject(projectDir, {
      "package.json": JSON.stringify({ name: "fixture", type: "module", main: "./index.ts" }),
      "source.ts": SOURCE_FILE,
      "index.ts": 'export { plain, aliased as renamed } from "./source";\n',
      "internal-barrel.ts": 'export { forwarded, kept } from "./source";\nexport type { Shape } from "./source";\n',
    });

    expect(await findUnusedExports(tsConfigPath, true)).toEqual([
      "source.ts:Shape",
      "source.ts:forwarded",
      "source.ts:kept",
    ]);
  });
});

describe("fixing exports that are only re-exported", () => {
  test("removes the declarations together with every specifier that forwards them", async () => {
    const tsConfigPath = await createFixProject(projectDir, {
      "source.ts": SOURCE_FILE,
      "barrel.ts":
        'export { plain, kept } from "./source";\n' +
        'export { aliased as renamed } from "./source";\n' +
        'export type { Shape } from "./source";\n' +
        'import { forwarded } from "./source";\n' +
        "export { forwarded };\n",
      "index.ts": 'export { renamed } from "./barrel";\nexport * from "./barrel";\n',
      "consumer.ts": 'import { kept } from "./index";\nconsole.log(kept());\n',
    });

    const results = await fixProject(tsConfigPath);

    expect(results.errors).toEqual([]);
    expect(results.fixedExports).toBe(4);
    expect(await Bun.file(path.join(projectDir, "source.ts")).text()).toBe(
      "export function kept(): number { return 4; }\n",
    );
    expect(await Bun.file(path.join(projectDir, "barrel.ts")).text()).toBe('export { kept } from "./source";\n');
    expect(await Bun.file(path.join(projectDir, "index.ts")).text()).toBe('export * from "./barrel";\n');
    expect(await typecheck()).toBe("");
  });

  test("removes a local export list that only forwards the removed declaration", async () => {
    const tsConfigPath = await createFixProject(projectDir, {
      "local.ts": "function local(): number { return 1; }\nexport { local, local as alias };\nexport const used = 1;\n",
      "consumer.ts": 'import { used } from "./local";\nconsole.log(used);\n',
    });

    const results = await fixProject(tsConfigPath);

    expect(results.errors).toEqual([]);
    expect(await Bun.file(path.join(projectDir, "local.ts")).text()).toBe("export const used = 1;\n");
    expect(await typecheck()).toBe("");
  });

  test("removes forwarding imports when it deletes a completely unused file", async () => {
    const tsConfigPath = await createFixProject(projectDir, {
      "dead.ts": "export function dead(): number { return 1; }\n",
      "barrel.ts": 'import { dead } from "./dead";\nexport { dead };\nexport const used = 1;\n',
      "consumer.ts": 'import { used } from "./barrel";\nconsole.log(used);\n',
    });

    const results = await fixProject(tsConfigPath);

    expect(results.errors).toEqual([]);
    expect(results.deletedFiles).toBe(1);
    expect(await Bun.file(path.join(projectDir, "dead.ts")).exists()).toBe(false);
    expect(await Bun.file(path.join(projectDir, "barrel.ts")).text()).toBe("export const used = 1;\n");
    expect(await typecheck()).toBe("");
  });
});
