import { relative } from "node:path";
import { readCoverage } from "./readCoverage.ts";
import { readRuntimeSources } from "./readRuntimeSources.ts";

export async function checkCoverage(report: string, root: string): Promise<string> {
  const records = readCoverage(report, root);
  const sources = await readRuntimeSources(root);
  if (sources.length === 0) throw new Error("Empty runtime source inventory");
  const missing = sources.filter((source) => !records.has(source));
  if (missing.length > 0) {
    throw new Error(`Missing runtime coverage:\n${missing.map((source) => relative(root, source)).join("\n")}`);
  }

  const failures: string[] = [];
  for (const [source, counts] of records) {
    const lines = counts.linesFound === 0 ? 1 : counts.linesHit / counts.linesFound;
    const functions = counts.functionsFound === 0 ? 1 : counts.functionsHit / counts.functionsFound;
    if (lines < 0.9 || functions < 0.9) {
      failures.push(
        `${relative(root, source)}: lines ${(lines * 100).toFixed(2)}% (${counts.linesHit}/${counts.linesFound}), functions ${(functions * 100).toFixed(2)}% (${counts.functionsHit}/${counts.functionsFound})`,
      );
    }
  }
  if (failures.length > 0) throw new Error(`Coverage below 90% per file:\n${failures.sort().join("\n")}`);
  return `Coverage inventory: ${sources.length} runtime modules accounted for; all ${records.size} reported modules meet 90% lines and functions.`;
}
