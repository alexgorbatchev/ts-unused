# ts-unused

A CLI tool that analyzes TypeScript projects to find unused exports and unused properties in types and interfaces.

**ts-unused** is built with AI-assisted development in mind. Its primary goal is to audit codebases, especially those heavily modified by AI coding assistants, to identify dead code, unused types, _properties_, and exports. The intended workflow is to feed the tool's output back into an AI agent, allowing it to autonomously clean up and refactor the project. VSCode problem matcher makes it a fully integrated experience.

## Features

- **Finds Unused Exports**: Identifies functions, classes, types, interfaces, and constants that are exported but never imported or used elsewhere
- **Finds Completely Unused Files**: Identifies files where all exports are unused, suggesting the entire file can be deleted
- **Finds Unused Type Properties**: Detects properties in interfaces and type aliases that are defined but never accessed
- **Auto-Fix Command**: Automatically removes unused exports, properties, and deletes unused files with git safety checks
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

## Comparison with Similar Tools

### Feature Comparison

| Feature | `ts-unused` | [`tsr`](https://github.com/line/tsr) | [`ts-unused-exports`](https://github.com/pzavolinsky/ts-unused-exports) |
| :--- | :--- | :--- | :--- |
| **Goal** | **Report & Analyze** | **Remove (Tree-Shake)** | **Report** |
| **Unused Exports** | ✅ Detects and reports | ✅ Detects and removes | ✅ Detects and reports |
| **Unused Properties** | ✅ **Unique:** Checks `interface`/`type` properties | ❌ No property checks | ❌ No property checks |
| **Test-Only Usage** | ✅ **Unique:** Identifies "Used only in tests" | ⚠️ May delete if not entrypoint | ❌ No distinction |
| **Comment Support** | ✅ **Unique:** TODOs change severity | ✅ Skip/Ignore only | ✅ Skip/Ignore only |
| **Unused Files** | ✅ Reports completely unused files | ✅ Deletes unreachable files | ✅ Explicit report flag |
| **VS Code Integration** | ✅ **Problem Matcher provided** | ❌ Manual setup required | ❌ Manual setup / ESLint plugin |
| **Auto-Fix** | ✅ **New:** Removes unused code safely | ✅ **Primary Feature:** Auto-removes code | ❌ Manual removal required |
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
```

## Output

### Check Command Output

The script outputs:

1. **Completely Unused Files**: Files where all exports are unused (candidates for deletion)
2. **Unused Exports**: Functions, types, interfaces, and constants that are exported but never used
3. **Unused Properties**: Properties in types/interfaces that are defined but never accessed
3. **Summary**: Total count of unused items found

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

Summary:
  Unused exports: 3
  Unused properties: 3
```

### Example Fix Output

```
Fixing TypeScript project: /path/to/tsconfig.json

Deleting: src/unused-file.ts (all exports unused)
Fixing: src/helpers.ts
  Removed unused export: unusedFunction
Fixing: src/types.ts
  Removed unused property: UserConfig.unusedProp
Skipped: src/modified.ts (has local git changes)

Summary:
  Fixed exports: 1
  Fixed properties: 1
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

## License

MIT License
