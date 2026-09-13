# Implementation Plan: Document Exported Functions (#1)

## Milestone 1: Add JSDoc to all exports

### Goal

Every exported function in `src/sample.ts` has a JSDoc block with a description
and `@param` / `@returns` annotations.

### Acceptance Criteria

- **AC1**: Every exported function in `src/sample.ts` has a JSDoc block.
- **AC2**: Each JSDoc block includes a description, `@param` for each parameter,
  and `@returns` for the return value.

### Tasks

1. Add JSDoc to `add()` in `src/sample.ts`
2. Add JSDoc to `multiply()` in `src/sample.ts`

### Test Requirements

- Visual inspection: every `export function` is preceded by a `/** ... */` block.
