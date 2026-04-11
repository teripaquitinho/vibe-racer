import path from "path";

export function slugify(title: string, maxLength = 50): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength)
    .replace(/-$/, "");
}

export function taskBranchName(number: number, title: string): string {
  return `vibe-racer/${String(number).padStart(4, "0")}_${slugify(title)}`;
}

export function taskPlanFolder(
  plansDir: string,
  number: number,
  title: string,
): string {
  return path.join(
    plansDir,
    `${String(number).padStart(4, "0")}_${slugify(title)}`,
  );
}
