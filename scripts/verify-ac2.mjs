#!/usr/bin/env node

/**
 * AC2 Verification Script
 *
 * Builds a throwaway git repo from the incomplete-task fixture, calls handleQa,
 * and checks whether 05_qa.md names the seeded gap (missing JSDoc on multiply()).
 *
 * Usage: npx tsx scripts/verify-ac2.mjs
 *
 * Must be run under tsx. handleQa is bundled into dist/index.js without being re-exported,
 * so there is nothing to import from the built output — the script imports the TS source.
 *
 * This runs a real Claude Code session against a throwaway repo, so it costs tokens and
 * needs ANTHROPIC_API_KEY (or `claude login`). It exits non-zero on any failure, including
 * failing to run at all.
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

  let handleQa;
  try {
    ({ handleQa } = await import("../src/pipeline/handlers/qa.ts"));
  } catch (err) {
    // Exiting 0 here would report a pass for a verification that never ran.
    console.error("FAIL: could not import handleQa from source.");
    console.error("Run this script under tsx so TypeScript sources resolve:");
    console.error("");
    console.error("  npx tsx scripts/verify-ac2.mjs");
    console.error("");
    console.error("Import error:", err.message);
    console.error("Fixture directory preserved at:", tmp);
    process.exit(1);
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

  // handleQa calls updateStage(ctx.planPath) with a RELATIVE path, which resolves against
  // process.cwd() rather than ctx.cwd. In the CLI those are always the same directory, so
  // this never shows up there — but this script drives a handler against a temp repo, so
  // it must move into it first or the stage write lands nowhere.
  const originalCwd = process.cwd();
  process.chdir(tmp);
  try {
    await handleQa(ctx);
  } catch (err) {
    console.error("handleQa threw:", err.message);
    console.log("\nFixture directory preserved at:", tmp);
    process.exit(1);
  } finally {
    process.chdir(originalCwd);
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
