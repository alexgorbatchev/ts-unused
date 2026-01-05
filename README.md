# ts-unused

A CLI tool that analyzes TypeScript projects to find unused exports and unused properties in types and interfaces.

**ts-unused** is built with AI-assisted development in mind. Its primary goal is to audit codebases, especially those heavily modified by AI coding assistants, to identify dead code, unused types, _properties_, and exports. The intended workflow is to feed the tool's output back into an AI agent, allowing it to autonomously clean up and refactor the project. VSCode problem matcher makes it a fully integrated experience.

## Features

- **Finds Unused Exports**: Identifies functions, classes, types, interfaces, and constants that are exported but never imported or used elsewhere
- **Finds Completely Unused Files**: Identifies files where all exports are unused, suggesting the entire file can be deleted
- **Finds Unused Type Properties**: Detects properties in interfaces and type aliases that are defined but never accessed
- **Finds Never-Returned Types**: Detects union type branches in function return types that are declared but never actually returned
- **Auto-Fix Command**: Automatically removes unused exports, properties, deletes unused files, and fixes never-returned types with git safety checks
- **Structural Property Equivalence**: Handles property re-declarations across multiple interfaces - properties are considered "used" if structurally equivalent properties (same name and type) are accessed in any interface
- **Three-Tier Severity System**: Categorizes findings by severity level for better prioritization
  - **ERROR**: Completely unused code that should be removed
  - **WARNING**: Items with TODO comments that need attention
  - **INFO**: Items only used in tests (testing helpers)
- **TODO Comment Detection**: Identifies and highlights properties/types with TODO comments
- **Excludes Test Files**: Automatically excludes test files from analysis to avoid false positives (but tracks test-only usage)
- **Excludes @ts-nocheck Files**: Automatically excludes files with `// @ts-nocheck` on the first line
- **Inline Type Support**: Analyzes inline object types in addition to named interfaces and type aliases
- **VS Code Integration**: Problem matcher for displaying results in VS Code's Problems panel with severity indicators

## Limitations

- **Dynamic Access**: Properties accessed via computed property names (`obj[key]`) may not be detected
- **Re-exports**: Items that are re-exported through barrel files are considered used
- **Type Narrowing**: Properties accessed after type guards or conditional checks may not always be tracked through complex control flow

## Comparison With Similar Tools

### Feature Comparison

| Feature | `ts-unused` | [`tsr`](https://github.com/line/tsr) | [`ts-unused-exports`](https://github.com/pzavolinsky/ts-unused-exports) |
| :--- | :--- | :--- | :--- |
| **Goal** | **Report & Analyze** | **Remove (Tree-Shake)** | **Report** |
| **Unused Exports** | ✅ Detects and reports | ✅ Detects and removes | ✅ Detects and reports |
| **Unused Properties** | ✅ **Unique:** Checks `interface`/`type` properties | ❌ No property checks | ❌ No property checks |
| **Never-Returned Types** | ✅ **Unique:** Detects unused union branches | ❌ Not supported | ❌ Not supported |
| **Test-Only Usage** | ✅ **Unique:** Identifies "Used only in tests" | ⚠️ May delete if not entrypoint | ❌ No distinction |
| **Comment Support** | ✅ **Unique:** TODOs change severity | ✅ Skip/Ignore only | ✅ Skip/Ignore only |
| **Unused Files** | ✅ Reports completely unused files | ✅ Deletes unreachable files | ✅ Explicit report flag |
| **VS Code Integration** | ✅ **Problem Matcher provided** | ❌ Manual setup required | ❌ Manual setup / ESLint plugin |
| **Auto-Fix** | ✅ Removes unused code safely | ✅ **Primary Feature:** Auto-removes code | ❌ Manual removal required |
| **Accuracy** | ⭐️ **High** (Language Service) | ⚡️ **Fast** (Custom Graph) | ⚡️ **Fast** (Custom Parser) |
| **Entrypoints** | 🟢 Not required (Global scan) | 🔴 **Required** (Reachability graph) | 🟢 Not required (Global scan) |

### vs [tsr](https://github.com/line/tsr)

**tsr** is primarily a "tree-shaking" tool for source code, designed to automatically remove unused code.

- **Goal**: `tsr` focuses on **removing** code (autofix), while `ts-unused` focuses on **reporting** and analysis.
- **Detection**: `tsr` uses a reachability graph starting from defined entrypoints. If code isn't reachable, it's deleted. `ts-unused` scans all files and checks for global references using the TypeScript Language Service.

### vs [ts-unused-exports](https://github.com/pzavolinsky/ts-unused-exports)

**ts-unused-exports** is a specialized, high-performance tool for finding unused exported symbols.

- **Performance**: `ts-unused-exports` uses a custom parser and resolver, making it potentially faster on very large codebases than `ts-unused` (which uses the full TypeScript Language Service).
- **Accuracy**: `ts-unused` leverages the standard TypeScript Language Service, ensuring higher accuracy with complex re-exports, type inference, and aliasing.
- **Granularity**: `ts-unused` provides deeper analysis for **unused properties** and **test-only usage**, whereas `ts-unused-exports` focuses strictly on exported symbols.

## Installation

```bash
npm install -g ts-unused
# or
bun add -g ts-unused
```

## Usage

### Check Command (Analysis Only)

Analyze your project and report unused items without making any changes:

```bash
ts-unused check <path-to-tsconfig.json> [file-path-to-check]
# or simply:
ts-unused <path-to-tsconfig.json> [file-path-to-check]
```

### Fix Command (Auto-Remove)

Automatically remove unused exports, properties, and delete unused files:

```bash
ts-unused fix <path-to-tsconfig.json>
```

**Safety Features:**
- Checks git status before modifying each file
- Skips files with uncommitted local changes
- Reports which files were skipped
- Continues processing other files if one fails
- Provides detailed per-file logging

### Example

```bash
# Analyze only
ts-unused ./tsconfig.json

# Auto-fix
ts-unused fix ./tsconfig.json

# With custom config path
ts-unused ./tsconfig.json --config ./custom.config.ts
```

## Configuration

Create an `unused.config.ts` file in your project root (same directory as `tsconfig.json`) to customize the analysis behavior.

### Example Configuration

```typescript
import { defineConfig } from "ts-unused";

export default defineConfig({
  // Custom patterns for identifying test files
  testFilePatterns: [
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx",
    "**/__tests__/**",
    "**/Test*.ts", // Include files like TestLogger.ts
  ],

  // Files to completely ignore during analysis
  ignoreFilePatterns: [
    "**/generated/**",
    "**/*.d.ts",
  ],

  // Export names to ignore (supports glob patterns)
  ignoreExports: [
    "formatLogMessage", // Specific export
    "internal*",        // All exports starting with "internal"
  ],

  // Property names to ignore in interfaces/types
  ignoreProperties: [
    "message",    // Common error property
    "_*",         // Private-like properties
  ],

  // Type names to skip property analysis for
  ignoreTypes: [
    "*Config",    // Skip all config types
    "Options",
  ],

  // Whether to ignore module augmentation declarations
  // (declare module "..." blocks)
  ignoreModuleAugmentations: true,

  // Toggle specific analysis features
  analyzeExports: true,
  analyzeProperties: true,
  analyzeNeverReturnedTypes: true,
  detectUnusedFiles: true,
});
```

### Configuration Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `testFilePatterns` | `string[]` | `["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/__tests__/**"]` | Glob patterns for test file detection |
| `ignoreFilePatterns` | `string[]` | `[]` | Files to completely ignore during analysis |
| `ignoreExports` | `string[]` | `[]` | Export names to ignore (supports glob patterns) |
| `ignoreProperties` | `string[]` | `[]` | Property names to ignore (supports glob patterns) |
| `ignoreTypes` | `string[]` | `[]` | Type names to skip property analysis for |
| `ignoreModuleAugmentations` | `boolean` | `true` | Whether to ignore `declare module` blocks |
| `analyzeExports` | `boolean` | `true` | Enable/disable unused export detection |
| `analyzeProperties` | `boolean` | `true` | Enable/disable unused property detection |
| `analyzeNeverReturnedTypes` | `boolean` | `true` | Enable/disable never-returned type detection |
| `detectUnusedFiles` | `boolean` | `true` | Enable/disable completely unused file detection |

### Pattern Syntax

The configuration supports glob-like patterns:

- `*` - Matches any characters except `/`
- `**` - Matches any characters including `/`
- `?` - Matches any single character

Examples:
- `**/*.test.ts` - All `.test.ts` files in any directory
- `**/Test*.ts` - All files starting with `Test` and ending with `.ts`
- `internal*` - Names starting with `internal`
- `*Config` - Names ending with `Config`

### CLI Options

```bash
ts-unused [command] <path-to-tsconfig.json> [options]

Options:
  --config, -c <path>  Path to configuration file (default: unused.config.ts in project dir)
```

## Output

### Check Command Output

The script outputs:

1. **Completely Unused Files**: Files where all exports are unused (candidates for deletion)
2. **Unused Exports**: Functions, types, interfaces, and constants that are exported but never used
3. **Unused Properties**: Properties in types/interfaces that are defined but never accessed
4. **Never-Returned Types**: Union type branches in function return types that are never actually returned
5. **Summary**: Total count of unused items found

Each finding includes:
- File path relative to the project root
- Export/property name with location (`name:line:startColumn-endColumn`)
- Severity level (`[ERROR]`, `[WARNING]`, or `[INFO]`)
- Description of the issue

The column positions are 1-based (VS Code standard) and the range highlights the entire identifier name in VS Code's editor and Problems panel.

### Example Check Output

```
Analyzing TypeScript project: /path/to/tsconfig.json

Unused Exports:

packages/example/src/helpers.ts
  unusedFunction:10:1-15 [ERROR] (Unused function)
  createTestHelper:25:1-17 [INFO] (Used only in tests)

packages/example/src/constants.ts
  UNUSED_CONSTANT:20:7-22 [ERROR] (Unused const)

Unused Type/Interface Properties:

packages/example/src/types.ts
  UserConfig.unusedProp:5:3-13 [ERROR] (Unused property)
  UserConfig.futureFeature:12:3-16 [WARNING] (Unused property: [TODO] implement this later)
  TestHelpers.mockData:8:3-11 [INFO] (Used only in tests)

Never-Returned Types:

packages/example/src/api.ts
  processRequest.ErrorResult:15:17-28 [ERROR] (Never-returned type in union)
  fetchData.TimeoutError:42:25-37 [ERROR] (Never-returned type in union)

Summary:
  Unused exports: 3
  Unused properties: 3
  Never-returned types: 2
```

### Example Fix Output

```
Fixing TypeScript project: /path/to/tsconfig.json

Deleting: src/unused-file.ts (all exports unused)
Fixing: src/helpers.ts
  Removed unused export: unusedFunction
Fixing: src/types.ts
  Removed unused property: UserConfig.unusedProp
Fixing: src/api.ts
  ✓ Removed never-returned type 'ErrorResult' from processRequest
  ✓ Removed never-returned type 'TimeoutError' from fetchData
Skipped: src/modified.ts (has local git changes)

Summary:
  Fixed exports: 1
  Fixed properties: 1
  Fixed never-returned types: 2
  Deleted files: 1
  Skipped files: 1

Skipped files (have local git changes):
  src/modified.ts
```

### Severity Levels

- **[ERROR]** - Completely unused code (red in VS Code)
  - Should be removed or investigated
  - No references found in production or test code

- **[WARNING]** - Items with TODO comments (yellow in VS Code)
  - Indicates planned but not yet implemented features
  - Helps track technical debt

- **[INFO]** - Used only in tests (blue in VS Code)
  - Testing helpers, mocks, or test-specific utilities
  - Defined outside test files but only referenced from tests
  - Not necessarily a problem, but good to know

## How It Works

1. **Project Loading**: Uses ts-morph to load the TypeScript project based on the provided tsconfig.json
2. **Export Analysis**: For each exported declaration, finds all references across the codebase
3. **Property Analysis**: For interfaces and type aliases, checks each property for external references
4. **Reference Categorization**: Tracks references separately:
   - Total references (definition + all usages)
   - Test references (from test files)
   - Non-test references (from production code)
5. **Severity Assignment**:
   - Items with TODO comments → WARNING
   - Items only used in tests (nonTestReferences === 1 && testReferences > 0) → INFO
   - Completely unused items → ERROR
6. **Structural Equivalence Checking**: When a property has no direct references, searches for structurally equivalent properties (same name and type signature) across all interfaces and type aliases - if any equivalent property is used, all are considered used
7. **File Exclusion**: Automatically filters out from being analyzed:
   - Test files (files in `__tests__` directories or ending in `.test.ts` or `.spec.ts`)
   - Files with `// @ts-nocheck` on the first line
   - Note: Test files are still scanned for references to track test-only usage

## VS Code Integration

Add this task to your `.vscode/tasks.json` to run the analyzer with problem matcher support:

```json
{
  "label": "Find Unused Exports",
  "type": "shell",
  "command": "ts-unused",
  "args": ["./tsconfig.json"],
  "presentation": {
    "echo": true,
    "reveal": "always",
    "focus": false,
    "panel": "shared"
  },
  "problemMatcher": {
    "owner": "ts-unused",
    "fileLocation": ["relative", "${workspaceFolder}"],
    "pattern": [
      {
        "regexp": "^([^\\s].*?)$",
        "file": 1
      },
      {
        "regexp": "^\\s+(.+?):(\\d+):(\\d+)-(\\d+)\\s+\\[(ERROR|WARNING|INFO)\\]\\s+\\((.+)\\)$",
        "code": 1,
        "line": 2,
        "column": 3,
        "endColumn": 4,
        "severity": 5,
        "message": 6,
        "loop": true
      }
    ]
  }
}
```

This will:
- Display results in VS Code's Problems panel
- Show severity indicators (error, warning, info)
- Allow clicking to navigate to the exact file location
- Highlight the entire identifier (function name, property name, etc.) in the editor
- Provide quick fixes and context

## Advanced Features

### Never-Returned Types Detection

The analyzer detects when functions declare union types in their return type signature but never actually return certain branches of that union. This commonly occurs when:

- **Error Handling**: Functions declare error types but never return errors in practice
- **Refactoring**: Code evolution leaves unused type branches behind
- **Over-Engineering**: Return types are declared too broadly for actual usage

**Example:**

```typescript
interface SuccessResult {
  success: true;
  data: string;
}

interface ErrorResult {
  success: false;
  error: string;
}

type ResultType = SuccessResult | ErrorResult;

// ErrorResult is never returned
export function processData(): ResultType {
  // This function only ever returns SuccessResult
  return { success: true, data: "processed" };
}
```

**Detection Capabilities:**
- Analyzes all function return statements to determine actual return types
- Handles `Promise<Union>` types for async functions
- Works with type aliases and direct union declarations
- Supports primitive unions (`string | number | boolean`)
- Handles multi-way unions (3+ types)
- Normalizes boolean literals (`true | false` → `boolean`)

**Auto-Fix Behavior:**
- Removes never-returned types from the union declaration
- Preserves `Promise<>` wrapper for async functions
- Simplifies to single type when only one branch remains
- Skips functions that are completely unused (they get removed entirely)

After fixing the example above, the return type would become:
```typescript
export function processData(): SuccessResult {
  return { success: true, data: "processed" };
}
```

### Structural Property Equivalence

The analyzer handles cases where properties are re-declared across multiple interfaces with the same name and type. This commonly occurs with:

- **Interface Composition**: When spreading values between different interface types
- **Type Transformations**: When converting from one type to another via object spreading
- **Shared Property Patterns**: When multiple interfaces define the same property structure

**Example:**

```typescript
// Source interface
interface SourceOptions {
  timeout: number;
  retryCount: number;
}

// Different interface with same properties
interface ProcessedOptions {
  timeout: number;      // Same name and type
  retryCount: number;   // Same name and type
  additionalOption: string;
}

// Usage through type conversion
function handler(sourceOpts: SourceOptions) {
  const processedOpts: ProcessedOptions = {
    ...sourceOpts,  // timeout and retryCount flow here
    additionalOption: 'value'
  };
  
  console.log(processedOpts.timeout);  // Accesses ProcessedOptions.timeout
}
```

In this case, `SourceOptions.timeout` and `SourceOptions.retryCount` are **not** flagged as unused, even though they're never directly accessed. The analyzer recognizes that `ProcessedOptions.timeout` and `ProcessedOptions.retryCount` are structurally equivalent and used, so their counterparts in `SourceOptions` are also considered used.

## Programmatic API

ts-unused can be used as a library in your own tools and scripts.

### Installation

```bash
npm install ts-unused
# or
bun add ts-unused
```

### Basic Usage

```typescript
import path from "node:path";
import { analyzeProject, loadConfigSync, formatResults } from "ts-unused";

// Given a project root with unused.config.ts
const projectRoot = "/path/to/your/project";
const tsConfigPath = path.join(projectRoot, "tsconfig.json");

// Load config from unused.config.ts (auto-detected in project directory)
const config = loadConfigSync(tsConfigPath);

// Analyze with config
const results = analyzeProject(tsConfigPath, undefined, undefined, { config });

// Format and print results (same output as CLI)
const output = formatResults(results, projectRoot);
console.log(output);
```

### API Reference

#### `analyzeProject(tsConfigPath, onProgress?, targetFilePath?, options?)`

Analyzes a TypeScript project for unused exports, properties, and never-returned types.

```typescript
import { analyzeProject, type AnalysisResults, type AnalyzeProjectOptions } from "ts-unused";

const options: AnalyzeProjectOptions = {
  config: {
    ignoreFilePatterns: ["**/generated/**"],
    ignoreExports: ["internal*"],
    analyzeProperties: true,
  },
};

const results: AnalysisResults = analyzeProject(
  "./tsconfig.json",
  (current, total, filePath) => console.log(`Processing ${current}/${total}: ${filePath}`),
  undefined, // targetFilePath - analyze all files
  options
);

console.log(`Found ${results.unusedExports.length} unused exports`);
console.log(`Found ${results.unusedProperties.length} unused properties`);
console.log(`Found ${results.unusedFiles.length} completely unused files`);
console.log(`Found ${results.neverReturnedTypes?.length ?? 0} never-returned types`);
```

**Parameters:**
- `tsConfigPath` - Path to tsconfig.json
- `onProgress` - Optional callback for progress updates
- `targetFilePath` - Optional path to analyze a single file
- `options` - Optional `AnalyzeProjectOptions` object with `config` and/or `isTestFile`

**Returns:** `AnalysisResults` object with arrays of findings

#### `fixProject(tsConfigPath, onProgress?, isTestFile?)`

Automatically removes unused exports, properties, and deletes unused files.

```typescript
import { fixProject, type FixResults } from "ts-unused";

const results: FixResults = fixProject(
  "./tsconfig.json",
  (message) => console.log(message)
);

console.log(`Fixed ${results.fixedExports} exports`);
console.log(`Fixed ${results.fixedProperties} properties`);
console.log(`Fixed ${results.fixedNeverReturnedTypes} never-returned types`);
console.log(`Deleted ${results.deletedFiles} files`);
console.log(`Skipped ${results.skippedFiles.length} files (git changes)`);
```

**Parameters:**
- `tsConfigPath` - Path to tsconfig.json
- `onProgress` - Optional callback for status messages
- `isTestFile` - Optional custom test file detection function

**Returns:** `FixResults` object with counts and lists of changes

#### `formatResults(results, tsConfigDir)`

Formats analysis results into a human-readable string (same format as CLI output).

```typescript
import { analyzeProject, formatResults } from "ts-unused";

const results = analyzeProject("./tsconfig.json");
const formatted = formatResults(results, "./");
console.log(formatted);
```

#### `loadConfig(tsConfigPath)` / `loadConfigSync(tsConfigPath)`

Loads configuration from `unused.config.ts` in the project directory.

```typescript
import { loadConfig, loadConfigSync, type UnusedConfig } from "ts-unused";

// Async version
const config: UnusedConfig = await loadConfig("./tsconfig.json");

// Sync version  
const configSync: UnusedConfig = loadConfigSync("./tsconfig.json");

// Use with analyzeProject
const results = an![alt text](image.png)alyzeProject("./tsconfig.json", undefined, undefined, { config });
```

#### `defineConfig(config)`

Type-safe helper for creating configuration files.

```typescript
// unused.config.ts
import { defineConfig } from "ts-unused";

export default defineConfig({
  ignoreFilePatterns: ["**/generated/**"],
  ignoreExports: ["internal*"],
});
```

#### `createIsTestFile(patterns)`

Creates a custom test file detection function from glob patterns.

```typescript
import { analyzeProject, createIsTestFile } from "ts-unused";

const isTestFile = createIsTestFile([
  "**/*.test.ts",
  "**/*.spec.ts", 
  "**/test/**",
]);

const results = analyzeProject("./tsconfig.json", undefined, undefined, { isTestFile });
```

#### Pattern Matching Utilities

```typescript
import { matchesPattern, matchesFilePattern, patternToRegex } from "ts-unused";

// Match a name against patterns
matchesPattern("internalHelper", ["internal*"]); // true
matchesPattern("publicApi", ["internal*"]); // false

// Match a file path against patterns
matchesFilePattern("/project/src/generated/types.ts", ["**/generated/**"]); // true

// Convert a glob pattern to RegExp
const regex = patternToRegex("**/*.test.ts");
regex.test("src/utils.test.ts"); // true
```

## License

MIT License