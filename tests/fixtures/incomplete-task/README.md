# AC2 Test Fixture: Incomplete Task

This fixture contains a deliberately incomplete task for verifying that the QA lap
detects unmet acceptance criteria. The seeded gap is intentional — do not fix it.

## The Gap

`src/sample.ts` exports two functions. The acceptance criterion in `03_plan.md`
requires every exported function to have a JSDoc block. The second function
(`multiply`) has no JSDoc — this is the gap QA must find.
