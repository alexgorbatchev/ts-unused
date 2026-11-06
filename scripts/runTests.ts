import { execa } from "execa";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:os";
import { join } from "node:path";
import { checkCoverage } from "./checkCoverage.ts";

export async function runTests(root: string, cancelSignal?: AbortSignal): Promise<number> {
  const temporaryRoot = join(root, ".tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const scratch = await mkdtemp(join(temporaryRoot, "test-run-"));
  try {
    const temporaryDirectory = join(scratch, "tmp");
    const coverageDirectory = join(scratch, "coverage");
    await mkdir(temporaryDirectory);
    const result = await execa(
      process.execPath,
      [
        "test",
        "--coverage",
        "--coverage-reporter=text",
        "--coverage-reporter=lcov",
        `--coverage-dir=${coverageDirectory}`,
      ],
      {
        cwd: root,
        stdio: "inherit",
        env: { TMPDIR: temporaryDirectory, TMP: temporaryDirectory, TEMP: temporaryDirectory },
        cancelSignal,
        killDescendants: true,
        forceKillAfterDelay: 5_000,
        reject: false,
      },
    );
    if (result.isCanceled || cancelSignal?.aborted) return 130;
    if (result.signal) return 128 + constants.signals[result.signal];
    if (result.failed) return result.exitCode || 1;

    const report = await Bun.file(join(coverageDirectory, "lcov.info")).text();
    const summary = await checkCoverage(report, root);
    if (cancelSignal?.aborted) return 130;
    console.log(summary);
    return 0;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
