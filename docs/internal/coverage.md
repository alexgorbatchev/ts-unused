---
created_on: 2026-11-05 23:18
last_modified: 2026-11-05 23:54
status: current
---

# Coverage enforcement

This reference describes the contributor coverage gate and its source scope.

1. Run `just setup` with the Bun version pinned in `package.json`.
2. Run `just check` for formatting, lint, types, unused-code analysis and the complete test suite. `just test` runs the same test and coverage stage on its own.
3. Treat any nonzero exit as a failed check. Repair failing tests, missing instrumentation or insufficient coverage before publishing.

Pull request and release CI both invoke `just check`. The test runner creates a fresh directory under `.tmp/` for temporary files and the LCOV report, waits for the test process, then checks the report. A failed or canceled test process cannot become a passing coverage check. Missing, empty, malformed, unterminated, duplicate or internally inconsistent reports fail validation. The runner removes its owned temporary directory after completion or failure.

## Measured source

The independent inventory examines `src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}`, including dot-prefixed files and directories. It excludes `__tests__` directories and `.d.ts`, `.d.mts` and `.d.cts` declarations. Each remaining file is transpiled through the compiler API exported by the existing `ts-morph` dependency, retaining value imports and exports. Files whose output consists only of empty statements or local empty exports are erased declarations and need no coverage record. Syntax diagnostics fail inventory construction.

Executable entrypoints, enums, side-effect imports and value re-exports remain in the inventory. Names such as `types.ts` do not create exemptions. There is no generated-source exemption within `src`; the generated `dist` directory is outside the source inventory. Symbolic links at `src` or anywhere beneath it fail inventory construction, including directory links and dangling links; they cannot silently hide sources from coverage. An empty inventory or a missing runtime source record fails the gate.

Bun's native coverage configuration continues to exclude tests and temporary fixtures. Every reported module must meet at least 90% line coverage and 90% function coverage independently; high coverage in another file does not compensate. A metric with a zero denominator is 100%, matching the pinned Bun runtime. LCOV line entries must agree with their line counters, and all counters must be complete, nonnegative safe integers.

## CLI and subprocess coverage

Direct behavioral tests execute the real Yargs parser, command handlers and startup module inside Bun's instrumented test process. They assert status, output, file changes and preservation of files. The end-to-end subprocess tests remain in place for executable behavior and package consumers.

Separate subprocess LCOV reports are not merged: the pinned Bun reporter supplies function totals without function identities, so summing or taking maximum totals cannot establish distinct function coverage. Running a selected test file directly is useful during development but does not perform the full inventory gate.

The development supervisor uses Execa's cancellation and descendant termination support. Interrupt and termination requests remain failures even when a cooperating child exits zero. Execa's descendant handling is best effort: processes that create separate sessions or process groups can escape it, and Windows descendant termination depends on the parent still existing. Tests must clean up their own resources and avoid leaving detached processes.
