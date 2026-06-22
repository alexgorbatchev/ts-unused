# Task

> Add support for a strongly-typed configuration file `unused.config.ts` that is auto-detected in the target directory. If not present, defaults are assumed.

# Primary Objective

Implement configuration file support (`unused.config.ts`) to address false positives by allowing users to configure test file patterns, module augmentation handling, and other analysis behaviors.

# Open Questions

- [x] None at this time

# Tasks

- [x] **TS001**: Identify the root cause of the problem
  - False positives occur due to:
    1. Test file detection patterns being too rigid (e.g., `TestLogger.ts` not recognized)
    2. Module augmentation declarations being analyzed as unused exports
    3. Properties accessed via dynamic patterns (spread, bracket notation) not being tracked
    4. Error message properties not being recognized as used
    5. Shell config properties accessed indirectly not being detected
- [x] **TS002**: Create a failing test to isolate the problem
  - Created config integration tests demonstrating ignore patterns
- [x] **TS003**: Confirm the root cause of the problem based on the failing test
  - Tests confirm that ignoreExports, ignoreProperties, ignoreTypes patterns work
- [x] **TS004**: Design the solution
  - Created `UnusedConfig` type with configuration options
  - Implemented config file detection and loading
  - Integrated config into analysis pipeline
- [x] **TS005**: Implement configuration type definitions
  - Created `src/config.ts` with:
    - `UnusedConfig` interface with all configurable options
    - `defineConfig` helper function for type-safe config
    - Default configuration values
    - `mergeConfig` helper for combining user config with defaults
- [x] **TS006**: Implement configuration file loading
  - Created `src/loadConfig.ts` with:
    - Function to detect `unused.config.ts` in target directory
    - Dynamic import of the config file using Bun
    - Merge loaded config with defaults
    - Both sync and async versions
- [x] **TS007**: Update `isTestFile.ts` to use config patterns
  - Added `createIsTestFile` function that accepts custom patterns
  - Maintained backward compatibility with default `isTestFile` function
- [x] **TS008**: Update `checkExportUsage.ts` to respect ignore patterns
  - Added `CheckExportOptions` interface
  - Skip exports matching `ignoreExports` patterns
  - Handle module augmentation detection with `ignoreModuleAugmentations`
- [x] **TS009**: Update property analysis to respect ignore patterns
  - Updated `analyzeInterfaces.ts` with `ignoreProperties` and `ignoreTypes`
  - Updated `analyzeTypeAliases.ts` with same options
  - Updated `findUnusedProperties.ts` to pass through options
- [x] **TS010**: Update CLI to load and pass config
  - Added `--config` / `-c` flag for custom config path
  - Auto-loads `unused.config.ts` from project directory
  - Pass config through to analysis functions
- [x] **TS011**: Update `analyzeProject.ts` to accept config
  - Created `AnalyzeProjectOptions` interface
  - Backward compatible with existing `isTestFile` parameter
  - Thread config through to all analysis functions
- [x] **TS012**: Add comprehensive tests for config functionality
  - `config.test.ts` - Tests for defineConfig, mergeConfig, defaults
  - `loadConfig.test.ts` - Tests for config file loading
  - `patternMatcher.test.ts` - Tests for glob pattern matching
  - `config-integration.test.ts` - Integration tests with analyzeProject
- [x] **TS013**: Update README with configuration documentation
  - Documented all config options with table
  - Provided example `unused.config.ts`
  - Documented CLI `--config` flag
  - Documented pattern syntax
- [x] **TS014**: Export config types from package index
  - Exported `UnusedConfig` type
  - Exported `defineConfig` helper
  - Exported `createIsTestFile` function
  - Exported `loadConfig` and `loadConfigSync`
  - Exported pattern matcher utilities

# Acceptance Criteria

- [x] Primary objective is met
- [x] All temporary code is removed
- [x] All tasks are complete
- [x] Tests added for all new production features
- [x] Related READMEs and docs are updated
- [x] All code quality standards are met
- [x] All changes are checked into source control
- [x] All tests pass
- [x] All acceptance criteria are met
- [x] `bun lint`, `bun typecheck` and `bun test` commands runs successfully in the new worktree

# Change Log

- 2026-01-04: Created task file and set up worktree
- 2026-01-04: Implemented configuration file support with all features complete
