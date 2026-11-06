import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { checkCoverage } from "../checkCoverage.ts";
import { createCoverageReport } from "./helpers.ts";

let projectDir = "";

beforeEach(async () => {
  const temporaryRoot = resolve(import.meta.dir, "../../.tmp");
  await mkdir(temporaryRoot, { recursive: true });
  projectDir = await mkdtemp(join(temporaryRoot, "coverage-check-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("checkCoverage", () => {
  test("accepts complete runtime coverage at the exact per-file threshold", async () => {
    await Bun.write(join(projectDir, "src/cli.ts"), "console.log('cli');");
    await Bun.write(join(projectDir, "src/types.ts"), "export interface Shape { value: string }");
    const report = createCoverageReport("src/cli.ts", {
      linesFound: 10,
      linesHit: 9,
      functionsFound: 10,
      functionsHit: 9,
    });
    await expect(checkCoverage(report, projectDir)).resolves.toBe(
      "Coverage inventory: 1 runtime modules accounted for; all 1 reported modules meet 90% lines and functions.",
    );
  });

  test("rejects an omitted executable entry point even when other files have full coverage", async () => {
    await Bun.write(join(projectDir, "src/cli.ts"), "console.log('cli');");
    await Bun.write(join(projectDir, "src/library.ts"), "export const value = 1;");
    await expect(checkCoverage(createCoverageReport("src/library.ts"), projectDir)).rejects.toThrow(
      new Error(`Missing runtime coverage:\n${join("src", "cli.ts")}`),
    );
  });

  test("rejects a report that substitutes a similarly named file outside the project", async () => {
    const source = join(projectDir, "src/cli.ts");
    await Bun.write(source, "console.log('cli');");
    await expect(checkCoverage(createCoverageReport(resolve(projectDir, "../src/cli.ts")), projectDir)).rejects.toThrow(
      new Error(`Missing runtime coverage:\n${relative(projectDir, source)}`),
    );
  });

  test.each([
    [8, 10, "lines 80.00% (8/10), functions 100.00% (10/10)"],
    [10, 8, "lines 100.00% (10/10), functions 80.00% (8/10)"],
    [8, 8, "lines 80.00% (8/10), functions 80.00% (8/10)"],
  ])(
    "rejects a per-file deficit despite a passing aggregate: %i lines and %i functions",
    async (linesHit, functionsHit, detail) => {
      await Bun.write(join(projectDir, "src/cli.ts"), "console.log('cli');");
      await Bun.write(join(projectDir, "src/large.ts"), "console.log('large');");
      const report =
        createCoverageReport("src/cli.ts", { linesFound: 10, linesHit, functionsFound: 10, functionsHit }) +
        createCoverageReport("src/large.ts", {
          linesFound: 100,
          linesHit: 100,
          functionsFound: 100,
          functionsHit: 100,
        });
      await expect(checkCoverage(report, projectDir)).rejects.toThrow(
        new Error(`Coverage below 90% per file:\n${join("src", "cli.ts")}: ${detail}`),
      );
    },
  );

  test("preserves Bun's zero-denominator metric semantics", async () => {
    await Bun.write(join(projectDir, "src/cli.ts"), "import './value.ts';");
    await Bun.write(join(projectDir, "src/value.ts"), "export const value = 1;");
    const report =
      createCoverageReport("src/cli.ts", {
        linesFound: 0,
        linesHit: 0,
        functionsFound: 0,
        functionsHit: 0,
      }) + createCoverageReport("src/value.ts");
    await expect(checkCoverage(report, projectDir)).resolves.toBe(
      "Coverage inventory: 2 runtime modules accounted for; all 2 reported modules meet 90% lines and functions.",
    );
  });

  test("also enforces the threshold for reported modules outside the runtime inventory", async () => {
    await Bun.write(join(projectDir, "src/cli.ts"), "console.log('cli');");
    const report =
      createCoverageReport("src/cli.ts") +
      createCoverageReport("scripts/tool.ts", {
        linesFound: 10,
        linesHit: 0,
        functionsFound: 10,
        functionsHit: 0,
      });
    await expect(checkCoverage(report, projectDir)).rejects.toThrow(
      new Error(
        `Coverage below 90% per file:\n${join("scripts", "tool.ts")}: lines 0.00% (0/10), functions 0.00% (0/10)`,
      ),
    );
  });

  test("rejects an empty runtime inventory instead of certifying the wrong directory", async () => {
    await expect(checkCoverage(createCoverageReport("src/cli.ts"), projectDir)).rejects.toThrow(
      new Error("Empty runtime source inventory"),
    );
  });

  test("rejects an empty report", async () => {
    await Bun.write(join(projectDir, "src/cli.ts"), "console.log('cli');");
    await expect(checkCoverage("", projectDir)).rejects.toThrow(new Error("Empty LCOV report"));
  });
});
