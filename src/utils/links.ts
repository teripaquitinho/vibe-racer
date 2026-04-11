export function buildShareLink(
  repoUrl: string,
  branchName: string,
  filePath: string,
): string {
  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) return "";
  const [, owner, repo] = match;
  return `https://github.com/${owner}/${repo}/edit/${branchName}/${filePath}`;
}
