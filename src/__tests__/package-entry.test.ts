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

  const build = run(["just", "build-lib", "--outDir", path.join(packageDir, "dist")], REPO_ROOT);
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
        'export const config: IUnusedConfig = defineConfig({ packageMode: true, packageEntryPointSources: { "./dist/api.js": "src/entry.ts" } });',
        "// @ts-expect-error ignoreExports must be an array of export names",
        "export const invalid: IUnusedConfig = defineConfig({ ignoreExports: 1 });",
        "// @ts-expect-error mapping values must be source paths",
        'export const invalidMapping: IUnusedConfig = defineConfig({ packageEntryPointSources: { "./dist/api.js": 1 } });',
        "",
      ].join("\n"),
    );

    const result = run(["bun", "run", "tsgo", "--project", consumerDir], REPO_ROOT);

    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe.each(["node", "bun"])("synchronous configuration in %s", (runtime) => {
  test("loads a typed default config from a relative project directory", async () => {
    const projectDir = path.join(consumerDir, "default-config");
    await Bun.write(
      path.join(projectDir, "unused.config.ts"),
      [
        'import { defineConfig, type IUnusedConfig } from "ts-unused";',
        'const config: IUnusedConfig = { ignoreExports: ["publicApi"], analyzeProperties: false };',
        "export default defineConfig(config);",
      ].join("\n"),
    );
    const scriptPath = path.join(consumerDir, "default-config.mjs");
    await Bun.write(
      scriptPath,
      [
        'import { loadConfigSync } from "ts-unused";',
        'const config = loadConfigSync("./default-config");',
        "console.log(JSON.stringify([config.ignoreExports, config.analyzeProperties, config.analyzeExports]));",
      ].join("\n"),
    );

    const result = run([runtime, scriptPath], consumerDir);

    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString()).toBe('[["publicApi"],false,true]\n');
    expect(result.exitCode).toBe(0);
  });

  test("loads custom paths and named exports independently of the project directory", async () => {
    const configPath = path.join(consumerDir, "custom-config.ts");
    await Bun.write(configPath, 'export const ignoreProperties: string[] = ["internalState"];');
    const scriptPath = path.join(consumerDir, "custom-config.mjs");
    await Bun.write(
      scriptPath,
      [
        'import { loadConfigSync } from "ts-unused";',
        'const relative = loadConfigSync("missing-project", "./custom-config.ts");',
        `const absolute = loadConfigSync("missing-project", ${JSON.stringify(configPath)});`,
        "console.log(JSON.stringify([relative.ignoreProperties, absolute.ignoreProperties, absolute.analyzeExports]));",
      ].join("\n"),
    );

    const result = run([runtime, scriptPath], consumerDir);

    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString()).toBe('[["internalState"],["internalState"],true]\n');
    expect(result.exitCode).toBe(0);
  });

  test("returns defaults for missing default and custom configuration files", async () => {
    const scriptPath = path.join(consumerDir, "missing-config.mjs");
    await Bun.write(
      scriptPath,
      [
        'import { loadConfigSync } from "ts-unused";',
        'const implicit = loadConfigSync("./missing-project");',
        'const explicit = loadConfigSync("./missing-project", "./missing-config.ts");',
        "console.log(JSON.stringify([implicit.ignoreExports, implicit.analyzeExports, explicit.ignoreExports, explicit.analyzeExports]));",
      ].join("\n"),
    );

    const result = run([runtime, scriptPath], consumerDir);

    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString()).toBe("[[],true,[],true]\n");
    expect(result.exitCode).toBe(0);
  });

  test("preserves the config path and original failure in loading errors", async () => {
    const configPath = path.join(consumerDir, "failing-config.ts");
    await Bun.write(configPath, 'throw new Error("configuration failed");\nexport default {};');
    const scriptPath = path.join(consumerDir, "failing-config.mjs");
    await Bun.write(
      scriptPath,
      [
        'import assert from "node:assert/strict";',
        'import { loadConfigSync } from "ts-unused";',
        `assert.throws(() => loadConfigSync(".", ${JSON.stringify(configPath)}),`,
        `  new Error(${JSON.stringify(`Failed to load config from ${configPath}: configuration failed`)}));`,
      ].join("\n"),
    );

    const result = run([runtime, scriptPath], consumerDir);

    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
