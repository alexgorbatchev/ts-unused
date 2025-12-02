# User Prompt
> a function used only in tests that is outside of __tests__ folder is reported as unused, make failing test

# Primary Objective
Create a failing test that demonstrates the issue where a function used only in test files but located outside of the `__tests__` folder is incorrectly reported as unused.

# Open Questions
- [x] Should the function be in the `src/` directory or elsewhere? **Answer: In src/ with production code**
- [x] Should the test file be in the `__tests__` folder or can it be anywhere? **Answer: In __tests__**
- [x] What is the expected behavior - should such functions be reported as used or unused? **Answer: Should be reported as used in tests only, similar to how type properties are handled**

# Tasks
- [x] **TS001**: Identify the root cause of the problem
- [x] **TS002**: Create a failing test to isolate the problem, if unable to create a failing test STOP and report to the user
- [x] **TS003**: Confirm the root cause of the problem based on the failing test
- [x] **TS004**: Think very hard, step by step, to identify a solution, then STOP and:
    - Describe the problem as you understand it
    - Describe proposed solution
    - Iterate with the user on proposed solution
- [x] **TS005**: Write down follow up tasks needed to implement the solution
- [x] **TS006**: Implement the solution
- [x] **TS007**: Verify the solution works

# Acceptance Criteria
- [x] Primary objective is met
- [x] All temporary code is removed
- [x] All tasks are complete
- [x] Tests added for all new production features
- [ ] Related READMEs and docs are updated
- [x] All code quality standards are met
- [x] All changes are checked into source control
- [x] All tests pass
- [x] `bun lint`, `bun typecheck` and `bun test` commands runs successfully in the new worktree
- [ ] All acceptance criteria are met

# Change Log
- Created feature branch and worktree
- Created work file
- Answered clarification questions
- **TS001**: Analyzed the codebase - found that `checkExportUsage.ts` has logic to detect test-only usage but it's not working correctly
- **TS002**: Created failing test case:
  - Added `test-project/test-helpers.ts` with helper functions (createTestUser, createTestPost)
  - Added `test-project/__tests__/user.test.ts` that imports and uses createTestUser
  - Created `src/__tests__/test-only-functions.test.ts` test suite
  - Test fails: `createTestUser` has `onlyUsedInTests: false` but should be `true`
- **TS003**: Confirmed root cause:
  - Created debug test to examine reference counting
  - Found that TypeScript's `findReferences()` only returns the definition, not the test file usage
  - Root cause: `test-project/tsconfig.json` only includes `*.ts`, not `__tests__/**/*.ts`
  - When test files aren't in the TypeScript project, the language service can't find references from them
  - Result: Functions used only in tests appear completely unused
- Restructured test-project to match real-world setup:
  - Moved all .ts files to `test-project/src/`
  - Removed `include` from tsconfig (TypeScript auto-discovers all files)
  - Tests now pass - the tool correctly detects test-only usage when test files are in the project
- Analyzed real project (dotfiles-tool-installer) where `withMockServer` is reported as unused:
  - Added `withMockServer` function to test-helpers.ts (mimics real-world usage pattern)
  - Found the actual bug: `analyzeProject.ts` adds files to `unusedFiles` list when ALL exports are "unused"
  - But it doesn't distinguish between `onlyUsedInTests: true` (info) and completely unused (error)
  - Result: Files with only test-only exports appear in "Completely Unused Files" with [ERROR] instead of showing individual exports with [INFO]
- Created failing test that demonstrates the bug
- **TS004-TS005**: Identified solution
- **TS006**: Implemented fix in `analyzeProject.ts`:
  - Added `testOnly` counter to track exports that are test-only
  - Modified logic to exclude files from `unusedFiles` if ANY export is test-only
  - Result: Files with test-only exports now show individual exports with [INFO] severity
- **TS007**: Verified solution:
  - All 53 tests pass
  - `withMockServer` in real project now correctly shows as `[INFO] (Used only in tests)`
