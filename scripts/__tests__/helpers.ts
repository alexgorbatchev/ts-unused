import { join } from "node:path";
import type { ICoverageCounts } from "../ICoverageCounts.ts";

export function createCoverageReport(
  source: string,
  counts: ICoverageCounts = { linesFound: 10, linesHit: 10, functionsFound: 10, functionsHit: 10 },
): string {
  return [
    "TN:",
    `SF:${source}`,
    `FNF:${counts.functionsFound}`,
    `FNH:${counts.functionsHit}`,
    ...Array.from({ length: counts.linesFound }, (_, index) => `DA:${index + 1},${Number(index < counts.linesHit)}`),
    `LF:${counts.linesFound}`,
    `LH:${counts.linesHit}`,
    "end_of_record",
    "",
  ].join("\n");
}

export async function createTestProject(root: string): Promise<void> {
  const files: Record<string, string> = {
    "bunfig.toml": `[test]
coverage = true
coverageThreshold = { lines = 0.9, functions = 0.9 }
coverageSkipTestFiles = true
coveragePathIgnorePatterns = []
`,
    "src/value.ts": "export function value() { return 42; }\n",
    "value.test.ts": `import { expect, test } from "bun:test";
import { value } from "./src/value.ts";
test("calls the runtime function", () => expect(value()).toBe(42));
`,
    ready: "",
  };
  await Promise.all(Object.entries(files).map(([file, contents]) => Bun.write(join(root, file), contents)));
}

export async function prepareCooperativeTest(root: string): Promise<void> {
  await Bun.write(
    join(root, "value.test.ts"),
    `import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("waits for cancellation", async () => {
  const ready = Promise.withResolvers();
  const child = Bun.spawn([process.execPath, "descendant.ts"], {
    stdout: "inherit",
    stderr: "inherit",
    ipc() { ready.resolve(); },
  });
  await ready.promise;
  process.on("SIGTERM", async () => {
    writeFileSync("parent-signal", "SIGTERM");
    await child.exited;
    process.exit(0);
  });
  writeFileSync("parent-pid", String(process.pid));
  writeFileSync("ready", "ready");
  await new Promise(() => {});
}, 30_000);
`,
  );
  await Bun.write(
    join(root, "descendant.ts"),
    `import { writeFileSync } from "node:fs";
process.on("SIGTERM", () => {
  writeFileSync("descendant-signal", "SIGTERM");
  process.exit(0);
});
writeFileSync("descendant-pid", String(process.pid));
process.send("ready");
setInterval(() => {}, 1_000);
`,
  );
}

export async function prepareStubbornTest(root: string): Promise<void> {
  await Bun.write(
    join(root, "value.test.ts"),
    `import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("requires escalation", async () => {
  process.on("SIGTERM", () => writeFileSync("parent-signal", "SIGTERM"));
  writeFileSync("parent-pid", String(process.pid));
  writeFileSync("ready", "ready");
  await new Promise(() => {});
}, 30_000);
`,
  );
}
