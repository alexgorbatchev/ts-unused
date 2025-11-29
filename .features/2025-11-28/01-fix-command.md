# User Prompt
> lets add a cli command "fix" that will auto-remove things and also delete unused files

# Primary Objective
Add a "fix" CLI command that automatically removes unused exports and deletes unused files from the codebase.

# Open Questions
- [x] Should the fix command require confirmation before making changes, or have a --dry-run flag? **NO dry-run, direct fixes**
- [x] Should it handle all types of unused items (exports, properties, files) or just exports and files? **ALL (exports, properties, files)**
- [x] Should there be any safety mechanisms (e.g., backup, git status check)? **YES - check files don't have local git changes, skip and print error if they do**
- [x] What should the output/logging look like during the fix operation? **Detailed per file**

# Tasks
- [x] **TS001**: Identify the root cause of the problem (understand current architecture and what "fix" needs to do)
- [x] **TS002**: Create a failing test to isolate the problem, if unable to create a failing test STOP and report to the user
- [x] **TS003**: Confirm the root cause of the problem based on the failing test
- [x] **TS004**: Solution approved - implement fixProject with git checking, export/property removal, and file deletion
- [x] **TS005**: Implement `checkGitStatus` function to verify files don't have local changes
- [x] **TS006**: Implement `fixProject` core function with analysis and fixing logic
- [x] **TS007**: Add "fix" command to CLI
- [x] **TS008**: Update README with fix command documentation
- [x] **TS009**: Run all tests and verify everything passes

# Acceptance Criteria
- [x] Primary objective is met
- [x] Tests added for all new production features
- [x] Related READMEs and docs are updated
- [x] All code quality standards are met
- [x] All tests pass
- [x] All tasks are complete
- [x] All acceptance criteria are met

# Change Log
- Created feature branch `feature/2025-11-28/fix-command`
- Created work file `.features/2025-11-28/01-fix-command.md`
- **TS001 Complete**: Analyzed current architecture - understands analyzeProject, findUnusedExports, findUnusedProperties, and result structure
- **TS002 Complete**: Created failing test `fix-command.test.ts` that expects `fixProject` function to remove unused exports, properties, and delete unused files
- **TS003 Complete**: Confirmed test failure - need to implement fixProject module
- **TS004 Complete**: Solution design approved by user
- **TS005-TS009 Complete**: Implemented full fix functionality
  - Created `checkGitStatus.ts` for git safety checks
  - Created `fixProject.ts` with export/property removal and file deletion
  - Updated `cli.ts` with fix command support
  - Updated README.md with comprehensive fix documentation
  - All 45 tests passing
  - Typecheck passing
  - Manual CLI testing successful
