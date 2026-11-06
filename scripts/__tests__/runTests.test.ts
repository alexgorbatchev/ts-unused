import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { once } from "node:events";
import { watch } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runTests } from "../runTests.ts";
import { createCoverageReport, createTestProject, prepareCooperativeTest, prepareStubbornTest } from "./helpers.ts";

let projectDir = "";
let log: Mock<typeof console.log>;

beforeEach(async () => {
  const temporaryRoot = resolve(import.meta.dir, "../../.tmp");
  await mkdir(temporaryRoot, { recursive: true });
  projectDir = await mkdtemp(join(temporaryRoot, "coverage-runner-"));
  await createTestProject(projectDir);
  log = spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  log.mockRestore();
  await rm(projectDir, { recursive: true, force: true });
});

describe("runTests", () => {
  test("discovers the entire suite, validates its real LCOV report, and removes owned scratch", async () => {
    await Bun.write(
      join(projectDir, "second.test.ts"),
      `import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
test("has isolated temporary directories", async () => {
  expect(process.env.TMP).toBe(process.env.TMPDIR);
  expect(process.env.TEMP).toBe(process.env.TMPDIR);
  await writeFile(join(process.env.TMPDIR, "artifact"), "temporary");
  await writeFile("discovered", "second test ran");
});
`,
    );

    expect(await runTests(projectDir)).toBe(0);
    expect(await Bun.file(join(projectDir, "discovered")).text()).toBe("second test ran");
    expect(log.mock.calls).toEqual([
      ["Coverage inventory: 1 runtime modules accounted for; all 1 reported modules meet 90% lines and functions."],
    ]);
    expect(await readdir(join(projectDir, ".tmp"))).toEqual([]);
  });

  test("rejects omitted executable sources despite a passing native report", async () => {
    await Bun.write(join(projectDir, "src/cli.ts"), "console.log('entry point');\n");
    await expect(runTests(projectDir)).rejects.toThrow(
      new Error(`Missing runtime coverage:\n${join("src", "cli.ts")}`),
    );
    expect(log.mock.calls).toEqual([]);
    expect(await readdir(join(projectDir, ".tmp"))).toEqual([]);
  });

  test("keeps Bun's native per-file coverage failure", async () => {
    await Bun.write(
      join(projectDir, "src/value.ts"),
      "export function value() { return 42; }\nexport function unused() { return 7; }\n",
    );
    expect(await runTests(projectDir)).toBe(1);
    expect(log.mock.calls).toEqual([]);
    expect(await readdir(join(projectDir, ".tmp"))).toEqual([]);
  });

  test("preserves a test failure and removes scratch", async () => {
    await Bun.write(
      join(projectDir, "failure.test.ts"),
      'import { expect, test } from "bun:test"; test("fails", () => expect(1).toBe(2));\n',
    );
    expect(await runTests(projectDir)).toBe(1);
    expect(log.mock.calls).toEqual([]);
    expect(await readdir(join(projectDir, ".tmp"))).toEqual([]);
  });

  test("preserves an explicit child failure code", async () => {
    await Bun.write(join(projectDir, "value.test.ts"), "process.exit(23);\n");
    expect(await runTests(projectDir)).toBe(23);
    expect(await readdir(join(projectDir, ".tmp"))).toEqual([]);
  });

  test("preserves an uncaught child termination signal", async () => {
    await Bun.write(join(projectDir, "value.test.ts"), 'process.kill(process.pid, "SIGTERM");\n');
    expect(await runTests(projectDir)).toBe(143);
    expect(await readdir(join(projectDir, ".tmp"))).toEqual([]);
  });

  test("rejects missing fresh coverage even when a stale default report exists", async () => {
    const staleReport = createCoverageReport("src/value.ts");
    await Bun.write(join(projectDir, "coverage/lcov.info"), staleReport);
    await Bun.write(join(projectDir, "value.test.ts"), "process.exit(0);\n");
    await expect(runTests(projectDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await Bun.file(join(projectDir, "coverage/lcov.info")).text()).toBe(staleReport);
    expect(log.mock.calls).toEqual([]);
    expect(await readdir(join(projectDir, ".tmp"))).toEqual([]);
  });

  test("does not run an already canceled suite", async () => {
    expect(await runTests(projectDir, AbortSignal.abort())).toBe(130);
    expect(log.mock.calls).toEqual([]);
    expect(await readdir(join(projectDir, ".tmp"))).toEqual([]);
  });

  test("keeps cooperative cancellation nonzero and waits for ordinary descendant cleanup", async () => {
    await prepareCooperativeTest(projectDir);
    const watcher = watch(join(projectDir, "ready"));
    const ready = once(watcher, "change", { signal: AbortSignal.timeout(8_000) });
    const controller = new AbortController();
    const pending = runTests(projectDir, AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
    try {
      await ready;
      controller.abort();
      expect(await pending).toBe(130);
      expect(await Bun.file(join(projectDir, "parent-signal")).text()).toBe("SIGTERM");
      expect(await Bun.file(join(projectDir, "descendant-signal")).text()).toBe("SIGTERM");
      const parentPid = Number(await Bun.file(join(projectDir, "parent-pid")).text());
      const descendantPid = Number(await Bun.file(join(projectDir, "descendant-pid")).text());
      expect(() => process.kill(parentPid, 0)).toThrow();
      expect(() => process.kill(descendantPid, 0)).toThrow();
      expect(log.mock.calls).toEqual([]);
      expect(await readdir(join(projectDir, ".tmp"))).toEqual([]);
    } finally {
      controller.abort();
      watcher.close();
      await pending;
    }
  }, 20_000);

  test("escalates cancellation when the test process refuses graceful termination", async () => {
    await prepareStubbornTest(projectDir);
    const watcher = watch(join(projectDir, "ready"));
    const ready = once(watcher, "change", { signal: AbortSignal.timeout(8_000) });
    const controller = new AbortController();
    const pending = runTests(projectDir, AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
    try {
      await ready;
      controller.abort();
      expect(await pending).toBe(130);
      expect(await Bun.file(join(projectDir, "parent-signal")).text()).toBe("SIGTERM");
      const parentPid = Number(await Bun.file(join(projectDir, "parent-pid")).text());
      expect(() => process.kill(parentPid, 0)).toThrow();
      expect(log.mock.calls).toEqual([]);
      expect(await readdir(join(projectDir, ".tmp"))).toEqual([]);
    } finally {
      controller.abort();
      watcher.close();
      await pending;
    }
  }, 20_000);
});
