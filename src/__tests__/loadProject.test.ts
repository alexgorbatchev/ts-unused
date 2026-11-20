import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyzeProject } from "../analyzeProject";

test("reports a configuration diagnostic before analyzing sources", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ts-unused-invalid-"));
  try {
    const config = path.join(directory, "tsconfig.json");
    await writeFile(config, '{"compilerOptions":{"notACompilerOption":true},"files":["input.ts"]}');
    await writeFile(path.join(directory, "input.ts"), "export const input = 1;");
    await assert.rejects(analyzeProject(config), /Unknown compiler option 'notACompilerOption'/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports a missing configuration by path", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ts-unused-missing-"));
  try {
    await assert.rejects(analyzeProject(path.join(directory, "tsconfig.json")), /tsconfig\.json/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports the native project files in the existing order", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ts-unused-order-"));
  try {
    const config = path.join(directory, "tsconfig.json");
    await writeFile(config, '{"files":["Second.ts","first.ts"]}');
    await writeFile(path.join(directory, "Second.ts"), "export const second = 2;");
    await writeFile(path.join(directory, "first.ts"), "export const first = 1;");
    const findings = await analyzeProject(config);
    expect(findings.unusedExports.map((finding) => finding.filePath)).toEqual(["first.ts", "Second.ts"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
