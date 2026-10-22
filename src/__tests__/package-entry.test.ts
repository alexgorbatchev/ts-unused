import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.join(import.meta.dir, "../..");

let consumerDir = "";

function run(command: string[], cwd: string) {
  return Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
}

beforeAll(async () => {
  await mkdir(path.join(REPO_ROOT, ".tmp"), { recursive: true });
  consumerDir = await mkdtemp(path.join(REPO_ROOT, ".tmp/package-entry-"));
  const packageDir = path.join(consumerDir, "node_modules/ts-unused");
  await Bun.write(path.join(packageDir, "package.json"), Bun.file(path.join(REPO_ROOT, "package.json")));
  await Bun.write(path.join(consumerDir, "package.json"), JSON.stringify({ name: "consumer", type: "module" }));

  const build = run(
    ["bun", "run", "tsgo", "--project", "tsconfig.build.json", "--outDir", path.join(packageDir, "dist")],
    REPO_ROOT,
  );
  expect(build.stdout.toString()).toBe("");
  expect(build.exitCode).toBe(0);
}, 60_000);

afterAll(async () => {
  await rm(consumerDir, { recursive: true, force: true });
});

describe("published library entry", () => {
  test("loads in Node.js ESM through the package exports", () => {
    const script = [
      'import { defineConfig, mergeConfig } from "ts-unused";',
      "console.log(typeof defineConfig);",
      'console.log(JSON.stringify(mergeConfig(defineConfig({ ignoreExports: ["publicApi"] })).ignoreExports));',
    ].join("\n");

    const result = run(["node", "--input-type=module", "--eval", script], consumerDir);

    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString()).toBe('function\n["publicApi"]\n');
    expect(result.exitCode).toBe(0);
  });

  test("resolves declarations for consumers using Node.js module resolution", async () => {
    await Bun.write(
      path.join(consumerDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "nodenext",
          target: "es2022",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
        },
        files: ["consumer.ts"],
      }),
    );
    await Bun.write(
      path.join(consumerDir, "consumer.ts"),
      [
        'import { defineConfig, type IUnusedConfig } from "ts-unused";',
        "",
        'export const config: IUnusedConfig = defineConfig({ ignoreExports: ["publicApi"] });',
        "// @ts-expect-error ignoreExports must be an array of export names",
        "export const invalid: IUnusedConfig = defineConfig({ ignoreExports: 1 });",
        "",
      ].join("\n"),
    );

    const result = run(["bun", "run", "tsc", "--project", consumerDir], REPO_ROOT);

    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
