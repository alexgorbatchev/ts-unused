import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { readCoverage } from "../readCoverage.ts";
import { createCoverageReport } from "./helpers.ts";

describe("readCoverage", () => {
  test("reads complete counters, zero metrics, CRLF, and normalized source paths", () => {
    const root = resolve("coverage project");
    const report = [
      createCoverageReport("./src/../src/cli.ts", {
        linesFound: 2,
        linesHit: 1,
        functionsFound: 3,
        functionsHit: 2,
      }),
      createCoverageReport(resolve(root, "src/empty.ts"), {
        linesFound: 0,
        linesHit: 0,
        functionsFound: 0,
        functionsHit: 0,
      }),
    ]
      .join("")
      .replaceAll("\n", "\r\n");
    expect(readCoverage(report, root)).toEqual(
      new Map([
        [resolve(root, "src/cli.ts"), { linesFound: 2, linesHit: 1, functionsFound: 3, functionsHit: 2 }],
        [resolve(root, "src/empty.ts"), { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 }],
      ]),
    );
  });

  test.each(["", "\n", " \n\t"])("rejects an empty report %j", (report) => {
    expect(() => readCoverage(report, ".")).toThrow(new Error("Empty LCOV report"));
  });

  test.each([
    ["end_of_record\n", "", "Unterminated LCOV record"],
    ["TN:", "not-a-field", "Invalid LCOV line: not-a-field"],
    ["TN:", "BRF:0", "Unsupported LCOV field: BRF"],
    ["TN:", "TN:\nTN:", "Repeated LCOV field: TN"],
    ["SF:src/cli.ts\n", "", "Missing LCOV source"],
    ["SF:src/cli.ts", "SF:", "Missing LCOV source"],
    ["SF:src/cli.ts", "SF:src/cli\0.ts", "Invalid LCOV source path"],
    ["LF:10\n", "", "Missing LCOV LF: src/cli.ts"],
    ["LH:10\n", "", "Missing LCOV LH: src/cli.ts"],
    ["FNF:10\n", "", "Missing LCOV FNF: src/cli.ts"],
    ["FNH:10\n", "", "Missing LCOV FNH: src/cli.ts"],
    ["LF:10", "LF:10\nLF:10", "Repeated LCOV field: LF"],
    ["DA:1,1", "DA:1", "Invalid LCOV DA: 1"],
    ["DA:1,1", "DA:1,1,checksum", "Invalid LCOV DA: 1,1,checksum"],
    ["DA:1,1", "DA:0,1", "Invalid LCOV line: 0"],
    ["DA:1,1", "DA:2,1", "Invalid LCOV line: 2"],
    ["DA:1,1", "DA:x,1", "Invalid LCOV DA line: x"],
    ["DA:1,1", "DA:1,-1", "Invalid LCOV DA hits: -1"],
    ["DA:1,1", "DA:1,0", "Inconsistent LCOV counters: src/cli.ts"],
    ["LF:10", "LF:11", "Inconsistent LCOV counters: src/cli.ts"],
    ["LH:10", "LH:9", "Inconsistent LCOV counters: src/cli.ts"],
    ["FNH:10", "FNH:11", "Inconsistent LCOV counters: src/cli.ts"],
  ])("rejects malformed or incomplete data: %s -> %s", (before, after, message) => {
    const report = createCoverageReport("src/cli.ts").replace(before, after);
    expect(() => readCoverage(report, ".")).toThrow(new Error(message));
  });

  test.each(["-1", "1.5", "1e2", "NaN", "Infinity", "", " 10", "9007199254740992"])(
    "rejects a nonnegative-safe-integer violation %j",
    (value) => {
      const report = createCoverageReport("src/cli.ts").replace("FNH:10", `FNH:${value}`);
      expect(() => readCoverage(report, ".")).toThrow(new Error(`Invalid LCOV FNH: ${value}`));
    },
  );

  test("rejects another record that aliases an existing source", () => {
    const report = createCoverageReport("src/cli.ts") + createCoverageReport("src/../src/cli.ts");
    expect(() => readCoverage(report, ".")).toThrow(new Error("Duplicate LCOV source: src/../src/cli.ts"));
  });

  test("rejects a truncated record after a valid record", () => {
    const report = createCoverageReport("src/cli.ts") + "SF:src/other.ts\nFNF:1\n";
    expect(() => readCoverage(report, ".")).toThrow(new Error("Unterminated LCOV record"));
  });

  test("rejects an empty terminated record", () => {
    expect(() => readCoverage("end_of_record\n", ".")).toThrow(new Error("Missing LCOV source"));
  });
});
