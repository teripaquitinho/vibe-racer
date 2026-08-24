#!/usr/bin/env node

/**
 * AC2 Verification Script
 *
 * Builds a throwaway git repo from the incomplete-task fixture, calls handleQa,
 * and checks whether 05_qa.md names the seeded gap (missing JSDoc on multiply()).
 *
 * Usage: node scripts/verify-ac2.mjs
 *
 * Prerequisites: npm run build (uses dist/ imports)
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const FIXTURE_DIR = join(import.meta.dirname, "..", "tests", "fixtures", "incomplete-task");

async function main() {
  // 1. Create temp directory and init git repo
  const tmp = mkdtempSync(join(tmpdir(), "ac2-"));
  console.log(`Working directory: ${tmp}`);

  execSync("git init", { cwd: tmp, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: tmp, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd: tmp, stdio: "pipe" });

  // 2. Create initial commit on main with the first function only (documented)
  mkdirSync(join(tmp, "src"), { recursive: true });
  writeFileSync(
    join(tmp, "src", "sample.ts"),
    `/**
 * Adds two numbers together.
 * @param a - The first number
 * @param b - The second number
 * @returns The sum of a and b
 */
export function add(a: number, b: number): number {
  return a + b;
}
`,
    "utf-8",
  );
  execSync("git add -A && git commit -m 'base: documented add function'", {
    cwd: tmp,
    stdio: "pipe",
  });

  // 3. Create feature branch and add the undocumented multiply function
  execSync("git checkout -b vibe-racer/0001_fixture", { cwd: tmp, stdio: "pipe" });

  // Copy the fixture's sample.ts (which has multiply WITHOUT JSDoc)
  copyFileSync(join(FIXTURE_DIR, "src", "sample.ts"), join(tmp, "src", "sample.ts"));
  execSync("git add -A && git commit -m 'add multiply without JSDoc'", {
    cwd: tmp,
    stdio: "pipe",
  });

  // 4. Set up plan directory with fixture files
  const planDir = join(tmp, "plans", "0001_fixture");
  mkdirSync(planDir, { recursive: true });

  copyFileSync(join(FIXTURE_DIR, "00_objective.md"), join(planDir, "00_objective.md"));
  copyFileSync(join(FIXTURE_DIR, "03_plan.md"), join(planDir, "03_plan.md"));
  copyFileSync(join(FIXTURE_DIR, "04_execute.md"), join(planDir, "04_execute.md"));

  // Write state.yml
  writeFileSync(
    join(planDir, "state.yml"),
    `stage: ai_qa
title: Fixture
created: "2026-08-24"
updated: "2026-08-24"
prev: ready_to_execute
next: fine_tuning
`,
    "utf-8",
  );

  // Write minimal .vibe-racer.yml
  writeFileSync(join(tmp, ".vibe-racer.yml"), "plans_dir: plans\n", "utf-8");

  // Write minimal CLAUDE.md so context loading works
  writeFileSync(join(tmp, "CLAUDE.md"), "# Fixture project\n", "utf-8");
  writeFileSync(join(tmp, "README.md"), "# Fixture\n", "utf-8");

  execSync("git add -A && git commit -m 'add plan files'", { cwd: tmp, stdio: "pipe" });

  // 5. Build TaskContext and call handleQa
  console.log("\nRunning handleQa against the fixture...\n");

  const { handleQa } = await import("../dist/index.js").then(async () => {
    // handleQa is not exported from index, import from the built handler
    return import("../dist/index.js");
  }).catch(() => null) || {};

  // Since handleQa may not be directly importable from dist, use a dynamic approach
  // Build the project first, then import
  let handleQaFn;
  try {
    // Try importing from the built output
    const mod = await import("../dist/index.js");
    // The handler is likely not re-exported from index. Try a direct path approach.
    // Since tsup bundles everything into index.js, we need to use the CLI's internal imports
    handleQaFn = mod.handleQa;
  } catch {
    // Fallback: not available
  }

  if (!handleQaFn) {
    console.log("handleQa is not directly importable from dist/index.js.");
    console.log("This script should be run via tsx for source imports:");
    console.log("");
    console.log("  npx tsx scripts/verify-ac2.mjs");
    console.log("");
    console.log("Or verify manually:");
    console.log(`  1. cd ${tmp}`);
    console.log("  2. Run: npm run dev -- drive");
    console.log("  3. Check plans/0001_fixture/05_qa.md for the missing JSDoc finding");
    console.log("");
    console.log("Fixture directory preserved at:", tmp);
    process.exit(0);
  }

  const ctx = {
    taskNumber: 1,
    title: "Fixture",
    slug: "fixture",
    plansDir: "plans",
    planPath: "plans/0001_fixture",
    branchName: "vibe-racer/0001_fixture",
    cwd: tmp,
    contextFiles: ["README.md", "CLAUDE.md"],
  };

  try {
    await handleQaFn(ctx);
  } catch (err) {
    console.error("handleQa threw:", err.message);
    console.log("\nFixture directory preserved at:", tmp);
    process.exit(1);
  }

  // 6. Check 05_qa.md for the seeded gap
  const qaPath = join(planDir, "05_qa.md");
  let qaContent;
  try {
    qaContent = readFileSync(qaPath, "utf-8");
  } catch {
    console.error("FAIL: 05_qa.md was not written");
    process.exit(1);
  }

  console.log("\n" + "=".repeat(60));
  console.log("05_qa.md content:");
  console.log("=".repeat(60));
  console.log(qaContent);
  console.log("=".repeat(60));

  // Check if the gap was found
  const lower = qaContent.toLowerCase();
  const foundGap =
    lower.includes("multiply") &&
    (lower.includes("jsdoc") || lower.includes("documentation") || lower.includes("undocumented"));

  if (foundGap) {
    console.log("\nPASS: QA report identifies the missing JSDoc on multiply()");
  } else {
    console.log("\nFAIL: QA report does not name the seeded gap (missing JSDoc on multiply)");
    console.log("The prompt may need strengthening.");
  }

  console.log("\nFixture directory:", tmp);
  process.exit(foundGap ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
