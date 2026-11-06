import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execa } from "execa";
import { once } from "node:events";
import { watch } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { constants } from "node:os";
import { join, resolve } from "node:path";
import { createTestProject, prepareCooperativeTest } from "./helpers.ts";

let projectDir = "";
const script = resolve(import.meta.dir, "../test.ts");
const bunBanner = `bun test v${Bun.version} (${Bun.revision.slice(0, 9)})`;

beforeEach(async () => {
  const temporaryRoot = resolve(import.meta.dir, "../../.tmp");
  await mkdir(temporaryRoot, { recursive: true });
  projectDir = await mkdtemp(join(temporaryRoot, "coverage-bootstrap-"));
  await createTestProject(projectDir);
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("test bootstrap", () => {
  test("prints the validated summary and exits successfully", async () => {
    const result = await execa(process.execPath, [script], {
      cwd: projectDir,
      killDescendants: true,
      timeout: 10_000,
      reject: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `${bunBanner}\nCoverage inventory: 1 runtime modules accounted for; all 1 reported modules meet 90% lines and functions.`,
    );
    expect(await readdir(join(projectDir, ".tmp"))).toEqual([]);
  }, 20_000);

  test("always discovers the full suite instead of forwarding filters", async () => {
    await Bun.write(join(projectDir, "failure.test.ts"), "process.exit(23);\n");
    const result = await execa(process.execPath, [script, "value.test.ts"], {
      cwd: projectDir,
      killDescendants: true,
      timeout: 10_000,
      reject: false,
    });
    expect(result.exitCode).toBe(23);
    expect(await readdir(join(projectDir, ".tmp"))).toEqual([]);
  }, 20_000);

  test("turns a coverage rejection into a failed process", async () => {
    await Bun.write(join(projectDir, "src/cli.ts"), "console.log('entry point');\n");
    const result = await execa(process.execPath, [script], {
      cwd: projectDir,
      env: { AGENT: "1", RUNNER_DEBUG: "0", NO_COLOR: "1", FORCE_COLOR: "0" },
      killDescendants: true,
      timeout: 10_000,
      reject: false,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(bunBanner);
    expect(result.stderr.replace(/(Ran 1 test across 1 file\.) \[\d+(?:\.\d+)?(?:ms|s)\]/u, "$1 [duration]")).toBe(
      [
        "--------------|---------|---------|-------------------",
        "File          | % Funcs | % Lines | Uncovered Line #s",
        "--------------|---------|---------|-------------------",
        "All files     |  100.00 |  100.00 |",
        " src/value.ts |  100.00 |  100.00 | ",
        "--------------|---------|---------|-------------------",
        "",
        " 1 pass",
        " 0 fail",
        " 1 expect() calls",
        "Ran 1 test across 1 file. [duration]",
        "Missing runtime coverage:",
        join("src", "cli.ts"),
      ].join("\n"),
    );
    expect(await readdir(join(projectDir, ".tmp"))).toEqual([]);
  }, 20_000);

  test.each<NodeJS.Signals>(["SIGINT", "SIGTERM"])(
    "preserves %s cancellation and cleans up descendants",
    async (signal) => {
      await prepareCooperativeTest(projectDir);
      const watcher = watch(join(projectDir, "ready"));
      const ready = once(watcher, "change", { signal: AbortSignal.timeout(8_000) });
      const controller = new AbortController();
      const subprocess = execa(process.execPath, [script], {
        cwd: projectDir,
        cancelSignal: controller.signal,
        killDescendants: true,
        timeout: 12_000,
        reject: false,
      });
      try {
        await ready;
        subprocess.kill(signal);
        expect((await subprocess).exitCode).toBe(128 + constants.signals[signal]);
        expect(await Bun.file(join(projectDir, "parent-signal")).text()).toBe("SIGTERM");
        expect(await Bun.file(join(projectDir, "descendant-signal")).text()).toBe("SIGTERM");
        const parentPid = Number(await Bun.file(join(projectDir, "parent-pid")).text());
        const descendantPid = Number(await Bun.file(join(projectDir, "descendant-pid")).text());
        expect(() => process.kill(parentPid, 0)).toThrow();
        expect(() => process.kill(descendantPid, 0)).toThrow();
        expect(await readdir(join(projectDir, ".tmp"))).toEqual([]);
      } finally {
        controller.abort();
        watcher.close();
        await subprocess;
      }
    },
    20_000,
  );
});
