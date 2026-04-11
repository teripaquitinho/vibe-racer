import { readFileSync } from "node:fs";
import { basename } from "node:path";

const SECRET_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/,         // dotenv files
  /credentials\.json$/,     // GCP/generic credentials
  /\.pem$/,                 // PEM certificates/keys
  /\.key$/,                 // private keys
];

const SECRET_CONTENT_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/,                                // AWS access key ID
  /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/,      // PEM private key
  /ghp_[a-zA-Z0-9]{36}/,                             // GitHub personal access token
  /sk-[a-zA-Z0-9]{48}/,                              // OpenAI/Anthropic API key
];

const MAX_CONTENT_SCAN_SIZE = 100 * 1024; // 100 KB

export interface SecretMatch {
  file: string;
  reason: string;
}

export function checkFileName(filePath: string): string | null {
  const name = basename(filePath);
  for (const pattern of SECRET_FILE_PATTERNS) {
    if (pattern.test(name)) {
      return `Filename matches secret pattern: ${pattern.source}`;
    }
  }
  return null;
}

export function checkFileContent(filePath: string): string | null {
  let content: string;
  try {
    const buf = readFileSync(filePath);
    if (buf.length > MAX_CONTENT_SCAN_SIZE) return null;
    content = buf.toString("utf-8");
  } catch {
    return null; // Can't read → skip content scan
  }

  for (const pattern of SECRET_CONTENT_PATTERNS) {
    if (pattern.test(content)) {
      return `Content matches secret pattern: ${pattern.source}`;
    }
  }
  return null;
}

export function scanFiles(filePaths: string[]): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const filePath of filePaths) {
    const nameHit = checkFileName(filePath);
    if (nameHit) {
      matches.push({ file: filePath, reason: nameHit });
      continue; // No need to also scan content
    }
    const contentHit = checkFileContent(filePath);
    if (contentHit) {
      matches.push({ file: filePath, reason: contentHit });
    }
  }
  return matches;
}
