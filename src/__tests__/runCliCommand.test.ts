import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { runCliCommand } from "../runCliCommand";
import { createFixProject } from "./helpers";

let projectDir: string;
let originalEnvironment: NodeJS.ProcessEnv;
let log: Mock<typeof console.log>;
let write: Mock<typeof process.stdout.write>;

beforeEach(async () => {
  await mkdir(path.join(import.meta.dir, "../../.tmp"), { recursive: true });
  projectDir = await mkdtemp(path.join(import.meta.dir, "../../.tmp/cli-command-"));
  originalEnvironment = { ...process.env };
  process.env.AGENT = "1";
  log = spyOn(console, "log").mockImplementation(() => {});
  write = spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(async () => {
  log.mockRestore();
  write.mockRestore();
  process.env = originalEnvironment;
  await rm(projectDir, { recursive: true, force: true });
});

describe("CLI analysis status", () => {
  test.each([
    {
      name: "unused exports",
      source: "export const unused = 1;\n",
      config: { detectUnusedFiles: false },
    },
    {
      name: "unused properties",
      source: "export interface Model { unused?: string; }\n",
      config: { detectUnusedFiles: false, analyzeExports: false },
    },
    {
      name: "never returned types",
      source: 'export function read(): string | number { return "ok"; }\n',
      config: { detectUnusedFiles: false, analyzeExports: false, analyzeProperties: false },
    },
    {
      name: "duplicate types",
      source: "export type First = string;\nexport type Second = string;\n",
      config: {
        detectUnusedFiles: false,
        analyzeExports: false,
        analyzeProperties: false,
        analyzeNeverReturnedTypes: false,
      },
    },
  ])("returns failure for $name without changing files", async ({ source, config }) => {
    await createFixProject(projectDir, {
      "model.ts": source,
      "unused.config.ts": `export default ${JSON.stringify(config)};\n`,
    });
    expect(await runCliCommand("check", { project: projectDir })).toBe(1);
    expect(await Bun.file(path.join(projectDir, "model.ts")).text()).toBe(source);
    expect(write.mock.calls).toEqual([]);
  });

  test("limits analysis to a file and renders human progress", async () => {
    delete process.env.AGENT;
    delete process.env.CLAUDECODE;
    delete process.env.REPL_ID;
    await createFixProject(projectDir, {
      "entry.ts": 'console.log("entry");\n',
      "unused.ts": "export const unused = 1;\n",
    });
    const targetFile = path.join(projectDir, "entry.ts");
    expect(await runCliCommand("check", { project: projectDir, file: targetFile })).toBe(0);
    expect(log.mock.calls).toEqual([
      [`Analyzing TypeScript project: ${path.join(projectDir, "tsconfig.json")}`],
      [`Checking only: ${targetFile}`],
      [""],
      ["No unused exports or properties found!"],
    ]);
    expect(write.mock.calls).toEqual([
      ["\r\x1b[KProgress: [████████████████████████████████████████] 100% (1/1) entry.ts"],
      ["\r\x1b[K"],
    ]);
    expect(await Bun.file(path.join(projectDir, "unused.ts")).text()).toBe("export const unused = 1;\n");
  });
});

test("fix reports and preserves local Git changes", async () => {
  await createFixProject(projectDir, { "unused.ts": "export const unused = 1;\n" });
  const modified = "export const unused = 2;\n";
  await Bun.write(path.join(projectDir, "unused.ts"), modified);

  expect(await runCliCommand("fix", { project: projectDir })).toBe(0);
  expect(log.mock.calls).toEqual([
    [`Fixing TypeScript project: ${path.join(projectDir, "tsconfig.json")}`],
    [""],
    ["Skipped: unused.ts (has local git changes)"],
    [""],
    ["Summary:"],
    ["  Fixed exports: 0"],
    ["  Fixed properties: 0"],
    ["  Deleted files: 0"],
    ["  Skipped files: 1"],
    [""],
    ["Skipped files (have local git changes):"],
    ["  unused.ts"],
  ]);
  expect(await Bun.file(path.join(projectDir, "unused.ts")).text()).toBe(modified);
});
