# User Prompt

> lets implement completely unused files feature

# Primary Objective

Implement detection of completely unused files (where all exports are unused) similar to ts-unused-exports' `--findCompletelyUnusedFiles` feature.

# Open Questions

- [x] Should we add a CLI flag to enable/disable this feature, or always include it in the analysis?
  - **Answer**: No CLI flag needed, always include in analysis
- [x] How should we report unused files - as a separate section in the output or integrated with the existing export reporting?
  - **Answer**: Separate section, don't report individual exports for completely unused files
- [x] Should we exclude test files from the unused files detection, or treat them the same as production files?
  - **Answer**: Continue treating test files as currently handled (skip from analysis)
- [x] What should be the severity level for completely unused files (error, warning, or info)?
  - **Answer**: ERROR severity
- [x] Output format must work with VSCode problem matcher pattern

# Tasks

- [x] **TS001**: Update types to support unused files in AnalysisResults
- [x] **TS002**: Implement logic in analyzeProject to detect files where all exports are unused
- [x] **TS003**: Update formatResults to display unused files in the output
- [x] **TS004**: Add tests for unused file detection
- [x] **TS005**: Update CLI to support optional flag for unused files detection (if decided) - Decided not to add flag
- [x] **TS006**: Update documentation/README

# Acceptance Criteria

- [x] Primary objective is met
- [x] Files with all unused exports are correctly identified
- [x] Unused files are properly reported in the output
- [x] Test files are handled appropriately
- [x] All code quality standards are met
- [x] All tests pass
- [x] All tasks are complete
- [x] All acceptance criteria are met

# Change Log

- Created feature branch and work file
- Implemented unused file detection logic in `analyzeProject.ts`
- Updated `formatResults.ts` to report unused files
- Added tests in `src/__tests__/unused-files.test.ts`
- Updated `README.md`
