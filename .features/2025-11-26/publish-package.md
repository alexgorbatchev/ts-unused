---
# User Prompt
> need to make this package publishable, it should provide ts-unused binary

# Primary Objective
Configure the package for publishing to npm with a `ts-unused` binary executable.

# Open Questions
- [ ] None

# Tasks
- [x] **TS001**: Update `package.json` to add `bin` configuration pointing to the CLI entry point.
- [x] **TS002**: Ensure the CLI entry point has the correct shebang.
- [x] **TS003**: Update `package.json` `files`, `main`, `types` fields for publishing.
- [x] **TS004**: Verify the build output structure matches the `bin` configuration.
- [x] **TS005**: Add MIT License.

# Acceptance Criteria
- [x] Primary objective is met
- [x] All code quality standards are met
- [x] All tests pass
- [x] All tasks are complete
- [x] All acceptance criteria are met

# Change Log
- Initial creation of feature file.
- Updated `package.json` with `bin`, `files`.
- Removed `main` and `types` from `package.json` as this is a CLI-only package.
- Removed `src/index.ts`.
- Removed type generation from build process.
- Replaced `npm` with `bun` in scripts.
- Updated `src/cli.ts` shebang and usage.
- Configured build scripts using `bun build` for CLI.
- Verified build output and CLI execution.
- Added MIT License.
- Updated README.md with installation and usage instructions.
---
