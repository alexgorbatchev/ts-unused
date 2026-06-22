# Fix Type Assignability False Positive

**Date:** 2024-12-02
**Status:** In Progress

## Problem

The `isTypeAssignableTo()` function in `src/analyzeFunctionReturnTypes.ts` incorrectly reports false positives for "never returned" types when functions return structurally compatible inferred types.

### Specific Case

When a function like `createBaseResolvedConfig(toolConfig: ToolConfig): ToolConfig` returns a value created through object destructuring:

```typescript
const { platformConfigs, ...configWithoutPlatforms } = config;
return configWithoutPlatforms;
```

TypeScript infers an anonymous type for `configWithoutPlatforms` that is structurally assignable to `ToolConfig`, but `isTypeAssignableTo()` doesn't recognize this match and reports it as "never returned".

## Root Cause

The current `isTypeAssignableTo()` function (lines 137-193) doesn't properly handle structural type compatibility for:

- Inferred types from object destructuring
- Anonymous object types that are structurally equivalent to declared types
- Union type matching with structural compatibility

## Solution

Improve `isTypeAssignableTo()` to properly check structural compatibility using TypeScript's type checker capabilities.

## Tasks

- [ ] Create test case in `test-project/src/` reproducing the object destructuring scenario
- [ ] Add failing test in `src/__tests__/never-returned-types.test.ts`
- [ ] Fix `isTypeAssignableTo()` function
- [ ] Verify fix resolves both test case and real-world dotfiles-tool-installer issue
- [ ] Run full test suite

## Verification

Test with real-world case:

```bash
bun cli /Users/agorbatchev/Development/github/dotfiles-tool-installer/tsconfig.json
```

The `createBaseResolvedConfig` function should no longer be reported as never returning its declared type.
