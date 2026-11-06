import { resolve } from "node:path";
import type { ICoverageCounts } from "./ICoverageCounts.ts";

function readCount(value: string, field: string): number {
  const count = Number(value);
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(count)) {
    throw new Error(`Invalid LCOV ${field}: ${value}`);
  }
  return count;
}

export function readCoverage(report: string, root: string): Map<string, ICoverageCounts> {
  const sections = report.split(/^end_of_record\r?$/mu);
  if (sections.pop()?.trim()) throw new Error("Unterminated LCOV record");

  const records = new Map<string, ICoverageCounts>();
  for (const section of sections) {
    const fields = new Map<string, string>();
    const lines = new Map<number, number>();
    for (const line of section.split(/\r?\n/u).filter((entry) => entry.length > 0)) {
      const separator = line.indexOf(":");
      if (separator < 0) throw new Error(`Invalid LCOV line: ${line}`);
      const field = line.slice(0, separator);
      const value = line.slice(separator + 1);
      if (field === "DA") {
        const parts = value.split(",");
        const [lineText, hitText] = parts;
        if (parts.length !== 2 || lineText === undefined || hitText === undefined) {
          throw new Error(`Invalid LCOV DA: ${value}`);
        }
        const lineNumber = readCount(lineText, "DA line");
        if (lineNumber === 0 || lines.has(lineNumber)) throw new Error(`Invalid LCOV line: ${lineNumber}`);
        lines.set(lineNumber, readCount(hitText, "DA hits"));
        continue;
      }
      if (!["TN", "SF", "LF", "LH", "FNF", "FNH"].includes(field)) {
        throw new Error(`Unsupported LCOV field: ${field}`);
      }
      if (fields.has(field)) throw new Error(`Repeated LCOV field: ${field}`);
      fields.set(field, value);
    }

    const source = fields.get("SF");
    if (!source) throw new Error("Missing LCOV source");
    if (/[\0\r\n]/u.test(source)) throw new Error("Invalid LCOV source path");
    const sourcePath = resolve(root, source);
    if (records.has(sourcePath)) throw new Error(`Duplicate LCOV source: ${source}`);
    const count = (field: string) => {
      const value = fields.get(field);
      if (value === undefined) throw new Error(`Missing LCOV ${field}: ${source}`);
      return readCount(value, field);
    };
    const record: ICoverageCounts = {
      linesFound: count("LF"),
      linesHit: count("LH"),
      functionsFound: count("FNF"),
      functionsHit: count("FNH"),
    };
    if (
      record.linesFound !== lines.size ||
      record.linesHit !== [...lines.values()].filter((hits) => hits > 0).length ||
      record.functionsHit > record.functionsFound
    ) {
      throw new Error(`Inconsistent LCOV counters: ${source}`);
    }
    records.set(sourcePath, record);
  }
  if (records.size === 0) throw new Error("Empty LCOV report");
  return records;
}
