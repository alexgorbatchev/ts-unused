# ts-unused

A CLI tool that analyzes TypeScript projects to find unused exports and unused properties in types and interfaces.

**ts-unused** is built with AI-assisted development in mind. Its primary goal is to audit codebases, especially those heavily modified by AI coding assistants, to identify dead code, unused types, _properties_, and exports. The intended workflow is to feed the tool's output back into an AI agent, allowing it to autonomously clean up and refactor the project. VSCode problem matcher makes it a fully integrated experience.

## Features

- **Finds Unused Exports**: Identifies functions, classes, types, interfaces, and constants that are exported but never used elsewhere; importing a name without referencing it does not count as usage
- **Finds Completely Unused Files**: Identifies files where all exports are unused, suggesting the entire file can be deleted. A file another file imports for side effects (`import "./setup"`) is never reported as completely unused, because deleting it would break that import; its unused exports are still reported one by one
- **Finds Unused Type Properties**: Detects properties in interfaces and type aliases that are defined but never accessed
- **Finds Never-Returned Types**: Detects union type branches in function return types that are declared but never actually returned
- **Finds Duplicate Types**: Reports differently named interfaces and type aliases with matching structures, including primitive aliases and unions
- **Auto-Fix Command**: Automatically removes unused exports, properties, deletes unused files, and fixes never-returned types with git safety checks
- **Related Property Usage**: Tracks properties through inheritance, assignments, function arguments, and object spreads; matching names in unrelated types do not count as usage
- **Reflect-based Dynamic Access**: Recognizes properties accessed dynamically using `Reflect` methods (such as `Reflect.get`, `Reflect.set`, `Reflect.has`, etc.) with string/template literals as keys
- **Keyed Property Access**: Counts destructuring with quoted, numeric, or computed keys (`const { "aria-label": label, [KEY]: value } = props`, including parameters and assignment destructuring) and bracket access through a literal-typed or `unique symbol` key (`props[KEY]` where `KEY` is a string or number constant, a union of literals, or a `const KEY = Symbol()` that keys a property such as `interface Props { [KEY]: string }`) as reads of the matching property
- **Three-Tier Severity System**: Categorizes findings by severity level for better prioritization
  - **ERROR**: Completely unused code that should be removed
  - **WARNING**: Items with TODO comments that need attention
  - **INFO**: Items only used in tests or Storybook stories (testing helpers, story fixtures)
- **TODO Comment Detection**: Identifies and highlights properties/types with TODO comments
- **Excludes Test Files**: Automatically excludes test files from analysis to avoid false positives (but tracks test-only usage)
- **Storybook Story Files**: Treats the CSF meta and the story exports of story files as used, honoring `includeStories` and `excludeStories`, analyzes everything else in them, and reports code outside story files that only stories use as story-only (see [Storybook Story Files](#storybook-story-files))
- **Excludes @ts-nocheck Files**: Automatically excludes files with `// @ts-nocheck` on the first line
- **Inline Type Support**: Analyzes inline object types in addition to named interfaces and type aliases
- **VS Code Integration**: Problem matcher for displaying results in VS Code's Problems panel with severity indicators

## Limitations

- **Dynamic Access**: Properties accessed through a key whose type is not a specific literal (such as `obj[key]` where `key` is a `string`) are not detected. Literal keys like `obj["prop"]`, keys typed as string or number literals or `unique symbol`s (or unions of them), and `Reflect` calls with literal keys are detected.
- **Re-exports**: Re-exports alone are not usage. An export that is only forwarded through barrel files, whether by `export *`, `export { a } from`, `export { a as b } from`, `export type { A } from`, or importing a name only to list it in `export { a }`, is reported as unused; using the name through the barrel counts. Use `packageMode` to treat the package public API as used.
- **Imports**: Imports alone are not usage either. `import { a }`, `import { a as b }`, `import a`, `import type { A }`, and `import { type A }` count only when the imported binding is referenced in that file, in any position: calls, type annotations, JSX, `typeof`, decorators, and so on. For namespace imports, `ns.a` (or `ns.A` in a type) counts as usage of `a`; a namespace binding used as a whole value (`register(ns)`, `Object.keys(ns)`, `typeof ns`, `export { ns }`) counts as usage of every export of that module, because any of them can be reached at runtime; an unreferenced namespace import counts for nothing. A side-effect import (`import "./setup"`) is not usage of any export.
- **Dynamic imports**: `import("./a")` is not tracked as a module import. Property accesses on its awaited result count as usage of the accessed exports, but a file that is only loaded through `import()` for its side effects is reported as completely unused.
- **Type Narrowing**: Properties accessed after type guards or conditional checks may not always be tracked through complex control flow

## Comparison With Similar Tools

### Feature Comparison

| Feature                  | `ts-unused`                                         | [`tsr`](https://github.com/line/tsr)      | [`ts-unused-exports`](https://github.com/pzavolinsky/ts-unused-exports) |
| :----------------------- | :-------------------------------------------------- | :---------------------------------------- | :---------------------------------------------------------------------- |
| **Goal**                 | **Report & Analyze**                                | **Remove (Tree-Shake)**                   | **Report**                                                              |
| **Unused Exports**       | ✅ Detects and reports                              | ✅ Detects and removes                    | ✅ Detects and reports                                                  |
| **Unused Properties**    | ✅ **Unique:** Checks `interface`/`type` properties | ❌ No property checks                     | ❌ No property checks                                                   |
| **Never-Returned Types** | ✅ **Unique:** Detects unused union branches        | ❌ Not supported                          | ❌ Not supported                                                        |
| **Test-Only Usage**      | ✅ **Unique:** Identifies "Used only in tests"      | ⚠️ May delete if not entrypoint           | ❌ No distinction                                                       |
| **Comment Support**      | ✅ **Unique:** TODOs change severity                | ✅ Skip/Ignore only                       | ✅ Skip/Ignore only                                                     |
| **Unused Files**         | ✅ Reports completely unused files                  | ✅ Deletes unreachable files              | ✅ Explicit report flag                                                 |
| **VS Code Integration**  | ✅ **Problem Matcher provided**                     | ❌ Manual setup required                  | ❌ Manual setup / ESLint plugin                                         |
| **Auto-Fix**             | ✅ Removes unused code safely                       | ✅ **Primary Feature:** Auto-removes code | ❌ Manual removal required                                              |
| **Accuracy**             | ⭐️ **High** (Language Service)                      | ⚡️ **Fast** (Custom Graph)                | ⚡️ **Fast** (Custom Parser)                                             |
| **Entrypoints**          | 🟢 Not required (Global scan)                       | 🔴 **Required** (Reachability graph)      | 🟢 Not required (Global scan)                                           |

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

- Only edits or deletes files selected by the tsconfig (`files`, `include`, and `exclude`); imported files outside the project are never modified
- Removes the re-export specifiers (`export { a } from "./a"`, `export { a }`) and the unused import specifiers (`import { a }`, `import a`) that name a declaration whenever it removes that declaration, and the unreferenced namespace imports (`import * as ns`) of a file it deletes or removes every export from, so importers keep compiling; an emptied `export`/`import` declaration is removed entirely
- Keeps an unused export, or a completely unused file together with all of its exports, when one of those specifiers is in a file it does not edit (a file with local Git changes or outside the tsconfig), so no import or re-export is left dangling; the file with local changes is listed as skipped
- Never deletes a file that is imported for side effects (`import "./setup"`); it removes the file's unused exports instead
- Checks repository-wide Git status before making changes
- Skips staged, unstaged, renamed, and untracked files, including files in new directories
- Stops without editing if Git status fails in a detected repository
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

Both `check` and `fix` use this configuration, including ignore patterns, enabled analyses, test-file patterns, and package mode. Use `--config <path>` with either command to select a different configuration file.

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

  // Storybook story files: the CSF meta and stories count as used (these are the defaults; [] turns it off)
  storyFilePatterns: ["**/*.stories.ts", "**/*.stories.tsx", "**/*.stories.js", "**/*.stories.jsx", "**/*.stories.mjs"],

  // Files to completely ignore during analysis
  ignoreFilePatterns: ["**/generated/**", "**/*.d.ts"],

  // Export names to ignore (supports glob patterns)
  ignoreExports: [
    "formatLogMessage", // Specific export
    "internal*", // All exports starting with "internal"
  ],

  // Property names to ignore in interfaces/types
  ignoreProperties: [
    "message", // Common error property
    "_*", // Private-like properties
  ],

  // Type names to skip property and duplicate-type analysis for
  ignoreTypes: [
    "*Config", // Skip all config types
    "Options",
  ],

  // Whether to ignore module augmentation declarations
  // (declare module "..." blocks)
  ignoreModuleAugmentations: true,

  // Toggle specific analysis features
  analyzeExports: true,
  analyzeProperties: true,
  analyzeNeverReturnedTypes: true,
  analyzeDuplicateTypes: true,
  detectUnusedFiles: true,

  // Choose which rules fail checks (off | info | warning | error)
  rules: {
    unusedExports: "error",
    unusedProperties: "error",
    unusedFiles: "error",
    neverReturnedTypes: "warning",
    duplicateTypes: "error",
    todoComments: "warning",
    ignoreComments: "off",
    storyOnlyUsage: "info",
  },

  // Enable package mode for library development
  // Treats exports reachable from package entry points, and the properties of types in the public API, as "used"
  packageMode: true,
});
```

### Configuration Options

| Option                      | Type       | Default                                                                                 | Description                                                               |
| --------------------------- | ---------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `testFilePatterns`          | `string[]` | `["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/__tests__/**"]` | Glob patterns for test file detection                                     |
| `storyFilePatterns`         | `string[]` | `["**/*.stories.ts", "**/*.stories.tsx", "**/*.stories.js", "**/*.stories.jsx", "**/*.stories.mjs"]` | Storybook story files, matched relative to the tsconfig directory; `[]` turns story handling off (see [Storybook Story Files](#storybook-story-files)) |
| `ignoreFilePatterns`        | `string[]` | `[]`                                                                                    | Files to skip entirely, matched relative to the tsconfig directory (see [Ignored Files](#ignored-files)) |
| `ignoreExports`             | `string[]` | `[]`                                                                                    | Export names to ignore (supports glob patterns)                           |
| `ignoreProperties`          | `string[]` | `[]`                                                                                    | Property names to ignore (supports glob patterns)                         |
| `ignoreTypes`               | `string[]` | `[]`                                                                                    | Type names to skip property and duplicate-type analysis for               |
| `ignoreModuleAugmentations` | `boolean`  | `true`                                                                                  | Whether to ignore `declare module` blocks                                 |
| `analyzeExports`            | `boolean`  | `true`                                                                                  | Enable/disable unused export detection                                    |
| `analyzeProperties`         | `boolean`  | `true`                                                                                  | Enable/disable unused property detection                                  |
| `analyzeNeverReturnedTypes` | `boolean`  | `true`                                                                                  | Enable/disable never-returned type detection                              |
| `analyzeDuplicateTypes`     | `boolean`  | `true`                                                                                  | Enable/disable duplicate-type detection                                   |
| `detectUnusedFiles`         | `boolean`  | `true`                                                                                  | Enable/disable completely unused file detection                           |
| `packageMode`               | `boolean`  | `false`                                                                                 | Treat exports reachable from package entry points, and properties of public API types, as used (for libraries) |
| `rules`                     | `Partial<Record<RuleName, RuleSeverity>>` | `{}` | Per-rule severity overrides; omitted rules retain their default behavior |

### Rule Severities

Each rule accepts `"off"`, `"info"`, `"warning"`, or `"error"`. `off` suppresses its findings. `check` exits with code 1 when any enabled rule reports an error, including duplicate types. Warnings and info do not fail checks.

Plain string keys and severity values are fully supported and type-checked, as shown above. Constants are optional: the package exports `RULE_NAME`, `RULE_SEVERITY`, `SEVERITY`, `COMMENT_KIND`, and `EXPORT_KIND` as frozen constant objects for configuration and API consumers. `RuleName`, `RuleSeverity`, `Severity`, `CommentKind`, and `ExportKind` are derived from their corresponding constant values.

| Rule | Default behavior |
| :--- | :--- |
| `unusedExports` | Error; info for test-only usage |
| `unusedProperties` | Error; info for test-only usage |
| `unusedFiles` | Error |
| `neverReturnedTypes` | Error |
| `duplicateTypes` | Error |
| `todoComments` | Warning for unused exports/properties annotated with TODO comments |
| `ignoreComments` | Warning for unused exports/properties annotated with `@ts-unused-ignore` comments |
| `storyOnlyUsage` | Info for exports and properties outside story files that only story files use (see [Storybook Story Files](#storybook-story-files)) |

TODO and ignore annotations select their own rule instead of the unused-export/property rule. For example, `rules: { unusedExports: "error", todoComments: "warning", ignoreComments: "off" }` reports ordinary unused exports and test-only exports as errors, TODO findings as warnings, and suppresses ignore-comment findings. TODO/ignore rules still report annotated findings when `unusedExports` or `unusedProperties` is `off`. If both annotations apply, the ignore-comment rule takes precedence. Story-only findings select `storyOnlyUsage` instead of the unused-export/property rule, so `unusedExports` and `unusedProperties` do not change their severity; a TODO or ignore annotation on a story-only finding selects the annotation's rule. Omit a rule to preserve its default behavior. Unknown rule names and invalid severities abort analysis with an error.

The existing analysis switches still apply: `analyzeProperties: false` disables property analysis, including annotated properties, even with `rules.unusedProperties: "error"` or `rules.todoComments: "error"`. Disabling export reports with `rules.unusedExports: "off"` still allows unused-file detection and annotated export findings. Disabling export analysis with `analyzeExports: false` also prevents annotated export findings and unused-file detection, which depends on export analysis.

`fix` processes error-level findings only. It skips TODO/ignore, test-only, and story-only findings as direct fix targets even when configured as errors, and it does not merge duplicate types. Unused-file detection excludes files containing TODO/ignore, test-only, or story-only exports. Each rule is independent: downgrading `unusedFiles` does not downgrade individual unused exports, and an error-level unused-file finding can still delete a file whose export findings have a lower severity. An independently unused containing export or file can still be removed even when one of its properties has a TODO/ignore comment. Stronger child findings remain visible beneath a weaker file or parent-export finding.

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

A `**/` segment also matches no directory at all, so `**/generated/**` matches both `generated/types.ts` and `src/generated/types.ts`, and `src/**/index.ts` matches `src/index.ts`.

### Ignored Files

`ignoreFilePatterns` match each file's path relative to the directory of the analyzed `tsconfig.json`, so `generated/**` ignores the top-level `generated` directory, and `**/generated/**` ignores a `generated` directory at any depth inside the project. Patterns never match the directories that contain the project.

Ignored files are skipped entirely: they produce no findings in any analysis (unused exports, files, and properties, never-returned types, duplicate types, and TODO/ignore comments), their declarations are not compared in duplicate-type detection, and `fix` never edits or deletes them. Like files outside the tsconfig, they remain part of the TypeScript program, so their references still count as usage, and `fix` keeps an export or file that an ignored file names in an import, a named re-export, or a namespace import instead of leaving that specifier dangling. Ignoring generated code therefore does not make the source it imports look unused. As with files outside the tsconfig, an `export * from` in an ignored file does not keep the target file: if every export of that file is unused, `fix` deletes it and leaves the ignored file unchanged.

### CLI Options

```bash
ts-unused [command] <path-to-tsconfig.json> [options]

Options:
  --config, -c <path>  Path to configuration file (default: unused.config.ts in project dir)
```

### CI/CD and Automation Support

`ts-unused` is optimized for continuous integration (CI) pipelines and AI agent automated development.

#### Exit Codes

- **`0`**: Executed successfully with no `ERROR` severity violations.
- **`1`**: Executed successfully but found one or more `ERROR` severity violations (e.g., completely unused files, unused exports, unused properties, or never-returned types).

#### Interactive Progress Bar Suppression

By default, `ts-unused check` displays an interactive progress bar showing analysis status. When running under CI/CD environments, Claude Code, Replit, or other AI agents, the interactive progress bar is automatically suppressed to keep output clean, reduce terminal buffer noise, and conserve token usage.

The progress bar is suppressed if any of the following environment variables are set:

- **`CLAUDECODE=1`** (Claude Code)
- **`REPL_ID`** (Replit environments)
- **`AGENT=1`** (Generic AI agents or custom pipeline flags)

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

These are the defaults when the corresponding rule has no explicit severity override. TODO/ignore findings use `todoComments`/`ignoreComments` independently of unused-export/property severity:

- **[ERROR]** - Completely unused code and duplicate types (red in VS Code)
  - Should be removed or investigated
  - No references found in production or test code

- **[WARNING]** - Items with TODO or ignore comments (yellow in VS Code)
  - Indicates planned but not yet implemented features
  - Helps track technical debt

- **[INFO]** - Used only in tests or used only in stories (blue in VS Code)
  - Testing helpers, mocks, story fixtures, or props that only stories set
  - Defined outside test files but only referenced from tests, or defined outside story files and referenced from no production code but from stories
  - Not necessarily a problem, but good to know

## Magic Comments

The analyzer respects specific magic comments to bypass files or control warning severities.

### File-Level Skip (`// @ts-nocheck`)

Placing `// @ts-nocheck` on the first line of a file completely excludes that file from analysis. It is never checked for unused exports, properties, or union types.

```typescript
// @ts-nocheck
export const unusedValue = "this file is skipped";
```

### Technical Debt Tracking (`// TODO`)

Adding a `TODO` comment above an unused property or exported declaration (such as a function, class, type, interface, etc.) selects the `todoComments` rule, which defaults to `[WARNING]`. Set `rules.todoComments` to `off`, `info`, `warning`, or `error` independently of unused-code rules. The `fix` command skips the annotated finding as a direct fix target at every severity; independently unused containers remain governed by their own rules.

Both single-line and multi-line comment formats are supported:

```typescript
// TODO implement dynamic sync later
export function syncDatabase(): void {
  console.log("synced");
}

export interface UserProfile {
  id: string;
  name: string;
  
  // TODO implement profile avatar loading later
  avatarUrl?: string;
  
  /**
   * TODO support OAuth provider integration
   */
  oauthProvider?: string;
}
```

### Selective Ignore (`// @ts-unused-ignore <required reason>`)

Placing `// @ts-unused-ignore` followed by a required reason comment directly above an unused property or exported declaration selects the `ignoreComments` rule, which defaults to `[WARNING]`. Set `rules.ignoreComments` to `off`, `info`, `warning`, or `error` independently of TODO and unused-code rules. Findings include the ignore reason. The `fix` command skips the annotated finding as a direct fix target at every severity; independently unused containers remain governed by their own rules.

Both single-line and multi-line formats are supported, provided a non-empty reason is specified after the ignore keyword:

```typescript
export interface UserData {
  userId: number;
  userName: string;
  
  // @ts-unused-ignore used by external database serialization
  internalToken?: string;
}

// @ts-unused-ignore expected to be used by dynamic plugins
export function dynamicHook(): void {
  console.log("hook");
}
```

## How It Works

1. **Project Loading**: Uses ts-morph to load the TypeScript project based on the provided tsconfig.json. Only files selected by the tsconfig (`files`, `include`, and `exclude`) are reported or edited. Files outside that set that the program reaches through imports, such as a sibling package or a shared directory, still count as usage sources but are never reported, edited, or deleted.
2. **Export Analysis**: For each exported declaration, finds all references across the codebase. Export and import specifiers only name the export and are not counted; the references to the binding an import creates are, and a namespace import used as a whole value counts once for every export of its module
3. **Property Analysis**: For interfaces and type aliases, checks each property for external references
4. **Reference Categorization**: Tracks references separately:
   - Total references (definition + all usages)
   - Test references (from test files)
   - Story references (from story files that are not test files)
   - Production references (from all other files)
5. **Severity Assignment**:
   - TODO/ignore findings use their own rule settings, defaulting to WARNING
   - Story-only findings use the `storyOnlyUsage` rule, defaulting to INFO
   - Test-only findings default to INFO; an explicit unused-rule setting overrides this
   - Completely unused items default to ERROR
6. **Related Property Checking**: Tracks usage through inheritance and value flow, including assignments, function arguments, and spreads. Matching properties in unrelated types do not count as usage.
7. **File Exclusion**: Automatically filters out from being analyzed:
   - Test files (files in `__tests__` directories or ending in `.test.ts` or `.spec.ts`)
   - Files with `// @ts-nocheck` on the first line
   - Files matching `ignoreFilePatterns` (see [Ignored Files](#ignored-files))
   - Note: Test files are still scanned for references to track test-only usage, and ignored files for usage

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

### Package Mode (Library Development)

When developing npm packages or libraries, you typically export a public API through barrel files (index.ts) that re-export from internal modules. By default, ts-unused would report these internal exports as "unused" since they're only re-exported, not directly used.

Enable `packageMode: true` to treat exports as "used" if they are part of your package's public API:

```typescript
// unused.config.ts
import { defineConfig } from "ts-unused";

export default defineConfig({
  packageMode: true,
});
```

**How it works:**

1. Finds `package.json` in the same directory as the analyzed `tsconfig.json`
2. Collects every entry target from `main`, `module`, `types`, `typings`, and `exports`, including nested conditions and fallback arrays (for example `{ "import": { "types": "...", "default": "..." } }`)
3. Maps each target back to the source file it is built from (see [Entry point resolution](#entry-point-resolution))
4. Traces every symbol reachable from those source entry points, following named re-exports, aliased re-exports, `export *` chains at any depth, and namespace re-exports (`export * as ns`)
5. Marks exports that reach a package entry point as "used"
6. Marks every property of the interfaces and object type aliases in the public API as "used" (see [Public API properties](#public-api-properties))

Package mode fails with an error when `package.json` has no entry fields, or when none of its entry targets resolves to a project source file. Targets that do not resolve, such as stylesheets, are skipped as long as at least one entry resolves.

**Example project structure:**

```
package.json          # { "main": "./dist/index.js", "exports": { ".": "./dist/index.js" } }
src/
  index.ts            # export { formatDate } from "./utils";
  utils.ts            # export function formatDate() { ... }  ← Considered USED
  internal.ts         # export function helper() { ... }      ← Reported as UNUSED
```

In this example:

- `formatDate` is NOT reported as unused because it's re-exported through `src/index.ts` (the package entry point)
- `helper` IS reported as unused because it's not part of the public API

**Supports:**

- Multiple entry points via `exports` field (e.g., `"."`, `"./utils"`)
- Nested barrel files (`src/utils/index.ts` → `src/index.ts`)
- `export *` statements, including nested `export *` chains and `export * as ns`
- Mixed named and star exports
- Types and interfaces

`export *` does not re-export a module's `default` export, so a default export that is only reachable through `export *` is still reported as unused.

Re-exports count as public only when they reach an entry point. A named re-export in a barrel file that no entry point exports is not usage, the same as outside package mode.

#### Public API properties

Consumers of a library read and write the properties of the types it exposes, in code the analysis never sees. In package mode, ts-unused therefore treats every property of an interface or object type alias in the public API as used, even when nothing inside the package reads it.

The public API is what the package's emitted declaration files expose, starting from the entry points:

- Types exported from an entry point, directly or through any re-export chain
- Types that are not exported by name but appear in a public signature: parameter and return types of exported functions and of public class members, types of exported variables, property types of public types, heritage clauses, type arguments, and inferred return or variable types
- Types inside conditional and mapped types in those signatures, written out or inferred: the check, extends, and both branch types of `A extends B ? C : D`, the constraint, `as` clause, and template of `{ [K in keyof T]: V }`, and the type arguments of utility types such as `Pick<T, K>`, `Omit<T, K>`, and `Partial<T>`

A type that is only reachable structurally is still public: TypeScript emits it into the declaration files, consumers pass object literals of that type (which TypeScript checks for excess properties) and read its properties from returned values, and removing a property breaks their code.

Types used only inside function bodies, initializers, private class members, or files that no entry point reaches are analyzed as in the default mode:

```typescript
// src/client.ts, re-exported by the package entry point
interface Options { retries?: number; }      // Public: parameter type of an exported function
interface Scratch { buffer?: string; }       // Analyzed: used only inside the function body

export function connect(options: Options) {
  const scratch: Scratch = {};
  return [options, scratch];
}
```

#### Entry point resolution

Entry targets usually point at build output (`./dist/index.js`, `./dist/index.d.ts`) while the analysis runs on source files. Each target is resolved in this order:

1. **tsconfig build layout**: ts-unused computes the JavaScript and declaration output paths of every project source file from the analyzed tsconfig's `outDir`, `declarationDir`, and `rootDir`, using the same TypeScript API `tsc` uses to name emitted files, and maps a target back to the source that would emit it. This covers any source directory name, `.tsx`/`.mts`/`.cts` sources, and separate declaration directories.
2. **Source targets**: a target that is itself a project source file (for example `"exports": "./src/index.ts"`) is used directly.
3. **Conventional mapping**: otherwise a leading `dist/`, `build/`, `lib/`, or `out/` is replaced with `src/` and the extension with `.ts` (or `/index.ts`). This covers bundlers such as Vite, tsup, or `bun build`, whose entry names come from bundler configuration rather than the tsconfig.

When the tsconfig omits `rootDir`, the emitted layout depends on the TypeScript version that builds the package: TypeScript 6.0 and later default `rootDir` to the tsconfig directory, while earlier versions infer the common directory of all emitted source files. ts-unused accepts output paths from both layouts.

Limitations:

- Only the analyzed tsconfig is consulted. If the package is built with a different tsconfig (for example `tsconfig.build.json`) whose `outDir` or `rootDir` differs, the layout cannot be derived; set `rootDir` and `outDir` consistently or rely on the conventional mapping.
- Subpath pattern exports such as `"./*": "./dist/*.js"` are skipped.
- Configurations that emit a single `outFile` bundle cannot be mapped back to individual source files.

### Storybook Story Files

Storybook finds story files by glob and reads their exports at runtime ([Component Story Format](https://storybook.js.org/docs/api/csf)), so nothing imports a story. ts-unused treats files matching `storyFilePatterns` (by default `*.stories.ts`, `.tsx`, `.js`, `.jsx`, and `.mjs` at any depth, matched relative to the tsconfig directory like `ignoreFilePatterns`) as story files:

- **The meta and the stories count as used**: the default export (the CSF meta), `__namedExportsOrder`, and every named variable or function export that Storybook treats as a story. Exported types, interfaces, classes, and enums are never stories.
- **Everything else is analyzed normally**: exports that are not stories, unused properties, duplicate types, and never-returned types are reported in story files like anywhere else, and `fix` removes them under the usual rules. It never removes the meta or a story.
- **Usage from story files counts**: code declared in story files is used when stories use it. Code outside story files that production code does not use but stories do (a fixture module, a helper, or a prop that only stories set) is reported as `Used only in stories` by the `storyOnlyUsage` rule, which defaults to `[INFO]`. Usage from both stories and tests, without production usage, is story-only: stories render the code in a built Storybook, while tests only exercise it. Code declared in story files that only tests use is reported as `Used only in tests`.

```typescript
// button.stories.tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

export default { component: Button, excludeStories: /.*Data$/ } satisfies Meta<typeof Button>;

export const Primary: StoryObj<typeof Button> = { args: { label: "Save" } }; // Story: used
export const userData = { name: "Ada" }; // Excluded by excludeStories: analyzed like any export
export type ButtonStoryArgs = { label: string }; // Not a story: analyzed like any export
```

Named exports are stories unless the meta's `includeStories` or `excludeStories` leaves them out. ts-unused reads them the way Storybook's indexer does ([`parseIncludeExclude` and `_parseMeta`](https://github.com/storybookjs/storybook/blob/v10.6.3/code/core/src/csf-tools/CsfFile.ts)) and applies them with the same rule as Storybook's [`isExportStory`](https://github.com/storybookjs/storybook/blob/v10.6.3/code/core/src/csf/export-story.ts):

- An array of string literals matches export names exactly. A string literal is compiled to a regular expression, and a regular expression literal is used as written, flags included.
- An export is a story when `includeStories` is absent or matches it, and `excludeStories` is absent or does not match it, so exclusion wins when both match. `includeStories: []` makes no export a story.
- The meta is read from `export default { ... }`, from a variable it names (`const meta = { ... }; export default meta;`, or `export { meta as default }`), and through `as`, `satisfies`, and parentheses. As in the indexer, only identifier keys are read, so quoted keys and spreads are skipped.

When the filters cannot be read statically, every named variable or function export is treated as a story, which can hide unused exports in that file but never reports a story as unused. This applies when the default export is not an object literal (for example a function call), when a filter value is anything other than the forms above (an identifier, a template literal, or an array containing a regular expression, which Storybook itself rejects), and to CSF factory files (`const meta = preview.meta({ ... })` with `export const Primary = meta.story({ ... })`), whose filters ts-unused does not read from the `meta()` call.

A file that matches both `testFilePatterns` and `storyFilePatterns` is a test file. `ignoreFilePatterns` takes precedence over both: an ignored story file produces no findings, and its references still count as story usage. Set `storyFilePatterns: []` to treat story files like any other file. `packageMode` is independent of story handling.

### Duplicate Types

The analyzer reports independently defined interfaces and type aliases whose resolved structures match despite having different names. It compares properties regardless of declaration order, follows nested and recursive types, and includes primitive aliases, unions, generic parameters, callable types, and index signatures. Optional and `readonly` modifiers, generic constraints and defaults, and function parameter types remain significant. Instantiations of the same generic alias or interface match when their type arguments match. Independently declared generic types whose members instantiate them again with new type arguments, such as `type Next<T> = { next<R>(): Next<[T, R]> }`, never stop expanding; like TypeScript's own type comparison, the analyzer compares them through three nested expansions and treats them as matching when no difference appears within that depth.

Aliases that reuse existing definitions do not produce duplicate-definition or redundant-name findings. This includes direct aliases, utility-derived projections such as `Parameters<Handler>[0]` and React's `ComponentProps<typeof Component>`, and intersections composed entirely from existing props. Empty interfaces that only extend an existing definition also count as reuse. The analyzer follows the origins of resolved members, so independently authored object definitions inside utilities such as `Readonly<{ value: string }>` remain eligible for duplicate findings.

```typescript
interface IControlProps { value: string; }
type ForwardedControlProps = IControlProps; // Reuses the definition: no duplicate finding.
type CopiedControlProps = { value: string }; // Independently repeats the definition: duplicate.
```

Each additional independent definition in a matching group produces a finding with its location and a reference to the first matching source. A reused definition can serve as a comparison source for a later independent copy; an alias of that copy cannot make its own source appear duplicated. The default severity is error and causes checks to fail; use `rules: { duplicateTypes: "warning" }` to report duplicates without failing checks. When checking a single file, the analyzer compares its declarations against the rest of the project and reports findings in the requested file. Test files, ignored files, and files with `@ts-nocheck` are excluded from the comparison.

Declaration files emitted from the project's own sources are excluded from the comparison as well, because each one repeats the declarations of the source it was emitted from rather than defining them independently. This covers `.d.ts` copies that a build writes into a directory the tsconfig includes, such as Storybook output from `vite-plugin-dts`. A declaration file counts as emitted when the analyzed tsconfig would emit it (from `outDir`, `declarationDir`, and `rootDir`), or when the declaration map named by its `//# sourceMappingURL=` comment lists a source file of the program. Hand-written declaration files are compared like any other file. Emitted declarations still take part in the other analyses; exclude their directory in the tsconfig or with `ignoreFilePatterns` to skip them entirely.

Use `ignoreTypes` for intentionally distinct domain names, or disable this analysis with `analyzeDuplicateTypes: false`. Duplicate findings do not change unused-property results. The `fix` command does not merge duplicate definitions or rewrite their references.

### Related Property Usage

The analyzer tracks properties across declarations connected by inheritance or actual value flow. This includes:

- **Interface Composition**: When spreading values between different interface types
- **Type Transformations**: When converting from one type to another via object spreading
- **Assignments and Arguments**: When a value is assigned or passed to a different declared type

**Example:**

```typescript
// Source interface
interface SourceOptions {
  timeout: number;
  retryCount: number;
}

// Different interface with same properties
interface ProcessedOptions {
  timeout: number; // Same name and type
  retryCount: number; // Same name and type
  additionalOption: string;
}

// Usage through type conversion
function handler(sourceOpts: SourceOptions) {
  const processedOpts: ProcessedOptions = {
    ...sourceOpts, // timeout and retryCount flow here
    additionalOption: "value",
  };

  console.log(processedOpts.timeout); // Accesses ProcessedOptions.timeout
}
```

In this case, reading `ProcessedOptions.timeout` counts as usage of `SourceOptions.timeout` because the spread copies that property into the processed object. The matching `retryCount` declarations alone do not establish usage. Properties overwritten after a spread are not linked to the original value. Flows that occur only in tests remain test-only usage. `Reflect` access is matched against the receiver's type rather than every property with the same name in the project.

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

Analyzes a TypeScript project for unused exports, properties, never-returned types, and duplicate types.

```typescript
import { analyzeProject, type IAnalysisResults, type IAnalyzeProjectOptions } from "ts-unused";

const options: IAnalyzeProjectOptions = {
  config: {
    ignoreFilePatterns: ["**/generated/**"],
    ignoreExports: ["internal*"],
    analyzeProperties: true,
  },
};

const results: IAnalysisResults = analyzeProject(
  "./tsconfig.json",
  (current, total, filePath) => console.log(`Processing ${current}/${total}: ${filePath}`),
  undefined, // targetFilePath - analyze all files
  options,
);

console.log(`Found ${results.unusedExports.length} unused exports`);
console.log(`Found ${results.unusedProperties.length} unused properties`);
console.log(`Found ${results.unusedFiles.length} completely unused files`);
console.log(`Found ${results.neverReturnedTypes?.length ?? 0} never-returned types`);
console.log(`Found ${results.duplicateTypes?.length ?? 0} duplicate types`);
```

**Parameters:**

- `tsConfigPath` - Path to tsconfig.json
- `onProgress` - Optional callback for progress updates
- `targetFilePath` - Optional path to analyze a single file
- `options` - Optional `IAnalyzeProjectOptions` object with `config` and/or `isTestFile`

**Returns:** `IAnalysisResults` object with arrays of findings

#### `fixProject(tsConfigPath, onProgress?, options?)`

Automatically removes unused exports, properties, and deletes unused files.

```typescript
import { fixProject, type IFixResults } from "ts-unused";

const results: IFixResults = await fixProject(
  "./tsconfig.json",
  (message) => console.log(message),
  { config: { ignoreExports: ["publicApi"], analyzeProperties: false } },
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
- `options` - Optional `IAnalyzeProjectOptions` object with `config` and/or `isTestFile`; also accepts a custom test file detection function directly. `isTestFile` overrides `config.testFilePatterns`.

The library uses defaults when `config` is omitted. Pass configuration explicitly; automatic config-file loading is handled by the CLI.

**Returns:** `IFixResults` object with counts and lists of changes

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
import { loadConfig, loadConfigSync, type IUnusedConfig } from "ts-unused";

// Async version
const config: IUnusedConfig = await loadConfig("./tsconfig.json");

// Sync version
const configSync: IUnusedConfig = loadConfigSync("./tsconfig.json");

// Use with analyzeProject
const results = analyzeProject("./tsconfig.json", undefined, undefined, { config });
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

#### `mergeConfig(userConfig)`

Merges user configuration with default values. Useful when programmatically building config.

```typescript
import { mergeConfig, defaultConfig, type IUnusedConfig } from "ts-unused";

const partialConfig: IUnusedConfig = {
  packageMode: true,
  ignoreExports: ["internal*"],
};

// Returns complete config with all defaults filled in
const fullConfig = mergeConfig(partialConfig);
```

#### `defaultConfig`

The default configuration values used when no config is provided.

```typescript
import { defaultConfig } from "ts-unused";

console.log(defaultConfig.testFilePatterns);
// ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/__tests__/**"]
```

#### `createIsTestFile(patterns)` / `isTestFile`

Creates a custom test file detection function from glob patterns, or use the default `isTestFile`.

```typescript
import { analyzeProject, createIsTestFile, isTestFile } from "ts-unused";

// Use default test file detection
isTestFile(sourceFile); // checks against default patterns

// Create custom test file detector
const customIsTestFile = createIsTestFile(["**/*.test.ts", "**/*.spec.ts", "**/test/**"]);

const results = analyzeProject("./tsconfig.json", undefined, undefined, {
  isTestFile: customIsTestFile,
});
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

#### Exported Types

```typescript
import type {
  // Main result types
  IAnalysisResults, // Return type of analyzeProject()
  IUnusedExportResult, // Individual unused export finding
  IUnusedPropertyResult, // Individual unused property finding
  INeverReturnedTypeResult, // Individual never-returned type finding
  IDuplicateTypeResult, // Duplicate declaration and the matching original
  ITypeLocation, // Name and source location of a type declaration
  IFixResults, // Return type of fixProject()

  // Configuration types
  IUnusedConfig, // Configuration options interface
  RuleName, // Unused-code, duplicate-type, and TODO/ignore rule names
  RuleSeverity, // "off" | "info" | "warning" | "error"
  IAnalyzeProjectOptions, // Options for analyzeProject()

  // Utility types
  ExportKind, // "function" | "class" | "interface" | "type" | ...
  Severity, // "error" | "warning" | "info"
  CommentKind, // "todo" | "ignore"
  IsTestFileFn, // (sourceFile: SourceFile) => boolean
  IPropertyUsageResult, // Result of property usage check
} from "ts-unused";
```

## License

MIT License
