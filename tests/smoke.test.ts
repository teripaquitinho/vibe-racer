import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgVersion = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf-8")).version as string;

describe("smoke", () => {
  it("builds without errors", () => {
    execSync("npm run build", { cwd: projectRoot, stdio: "pipe" });
  });

  it("prints version with --version flag", () => {
    const output = execSync("./dist/index.js --version", {
      cwd: projectRoot,
      encoding: "utf-8",
    });
    expect(output.trim()).toBe(pkgVersion);
  });
});
