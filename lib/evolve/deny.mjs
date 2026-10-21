import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const IS_CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32';

export function loadDenyList(customPath) {
  const filePath = customPath || path.resolve(process.cwd(), 'deny-list.json');
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.paths) ? data.paths : [];
  } catch {
    return [];
  }
}

export function matchesPattern(relPath, pattern) {
  const normalizedPath = relPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');

  const cmpPath = IS_CASE_INSENSITIVE ? normalizedPath.toLowerCase() : normalizedPath;
  const cmpPattern = IS_CASE_INSENSITIVE ? normalizedPattern.toLowerCase() : normalizedPattern;

  if (cmpPattern === cmpPath) {
    return true;
  }

  if (cmpPattern.endsWith('/**')) {
    const prefix = cmpPattern.slice(0, -3);
    return cmpPath === prefix || cmpPath.startsWith(prefix + '/');
  }

  if (cmpPattern.includes('*')) {
    const regexStr = '^' + cmpPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/(?<!\.)\*/g, '[^/]*') + '$';
    return new RegExp(regexStr).test(cmpPath);
  }

  return false;
}

export function isDenied(targetPath, repoRoot = process.cwd(), customDenyList = null) {
  if (!targetPath) return true;

  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(repoRoot);

  // Check realpath if path or its parent exists to prevent symlink traversal
  let realTarget = resolvedTarget;
  try {
    if (fs.existsSync(resolvedTarget)) {
      realTarget = fs.realpathSync(resolvedTarget);
    } else {
      const parent = path.dirname(resolvedTarget);
      if (fs.existsSync(parent)) {
        realTarget = path.join(fs.realpathSync(parent), path.basename(resolvedTarget));
      }
    }
  } catch {
    realTarget = resolvedTarget;
  }

  // Deny escaping repository root
  const relFromRoot = path.relative(resolvedRoot, realTarget);
  if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) {
    return true;
  }

  // Explicitly deny external agent configuration and runtime paths
  const home = os.homedir();
  for (const forbiddenDir of ['.agents', '.claude', '.aos']) {
    const forbiddenPath = path.join(home, forbiddenDir);
    if (realTarget === forbiddenPath || realTarget.startsWith(forbiddenPath + path.sep)) {
      return true;
    }
  }

  const denyPatterns = customDenyList || loadDenyList(path.join(resolvedRoot, 'deny-list.json'));

  for (const pattern of denyPatterns) {
    if (matchesPattern(relFromRoot, pattern)) {
      return true;
    }
  }

  return false;
}

export function assertNotDenied(targetPath, repoRoot = process.cwd(), customDenyList = null) {
  if (isDenied(targetPath, repoRoot, customDenyList)) {
    throw new Error(`Access denied: path '${targetPath}' is protected by deny-list or escapes repository boundary.`);
  }
}

export default {
  loadDenyList,
  matchesPattern,
  isDenied,
  assertNotDenied,
};
