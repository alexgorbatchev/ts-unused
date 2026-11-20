import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { API } from "typescript/async";
import { fixProject } from "../fixProject";
import { loadProject, resolveConfigPath } from "../loadProject";
import { createFixProject } from "./helpers";

test.each([
  [
    "a multiline union",
    '\n  | { status: "success"; value: string | number }\n  | { status: "error"; reason: string }',
    "",
  ],
  [
    "a parenthesized Promise union",
    'Promise<({ status: "success"; value: string | number } | { status: "error"; reason: string })>',
    "async ",
  ],
])("preserves the retained inline object in %s", async (_description, annotation, modifier) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ts-unused-inline-"));
  try {
    const config = await createFixProject(directory, {
      "main.ts": `${modifier}function processData(): ${annotation} {
  return { status: "success", value: "ok" };
}
processData();
`,
    });
    const results = await fixProject(config);
    expect(results.errors).toEqual([]);
    expect(results.fixedNeverReturnedTypes).toBe(1);
    const updated = await Bun.file(path.join(directory, "main.ts")).text();
    expect(updated).toContain('{ status: "success"; value: string | number }');
    expect(updated).not.toContain('status: "error"');
    expect(updated).not.toContain("__type");
    await using api = new API();
    await using loaded = await loadProject(api, resolveConfigPath(config));
    expect(await loaded.project.program.getSemanticDiagnostics()).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
