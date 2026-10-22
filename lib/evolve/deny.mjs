/**
 * lib/evolve/deny.mjs
 *
 * Hard Safety Boundary B2: Immutable path protection and path confinement.
 *
 * Note on claim scope (Hard Safety Boundary B2):
 * The deny-list check applies to store paths only (what capture/store writes);
 * candidate diffs are NOT checked yet; a diff check is required before any
 * future step executes proposals (planned for 5.4.2+).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const IS_CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32';

export function getTrustRootDenyListPath() {
  const evolveCandidate = path.join(REPO_ROOT, 'evolve', 'deny-list.json');
  if (fs.existsSync(evolveCandidate)) {
    return evolveCandidate;
  }
  return path.join(REPO_ROOT, 'deny-list.json');
}

export function loadDenyList(customPath) {
  const filePath = customPath || getTrustRootDenyListPath();
  if (!fs.existsSync(filePath)) {
    throw new Error(`Deny-list file not found: ${filePath}`);
  }
  let data;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse deny-list at ${filePath}: ${err.message}`);
  }
  if (!data || !Array.isArray(data.paths)) {
    throw new Error(`Invalid deny-list structure at ${filePath}: 'paths' array required`);
  }
  return data.paths;
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
      .replace(/[.+^$${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/(?<!\.)\*/g, '[^/]*') + '$';
    return new RegExp(regexStr).test(cmpPath);
  }

  return false;
}

function resolveNearestRealPath(resolvedTarget) {
  let curr = resolvedTarget;
  const tailSegments = [];

  while (!fs.existsSync(curr)) {
    const parent = path.dirname(curr);
    if (parent === curr) {
      break;
    }
    tailSegments.unshift(path.basename(curr));
    curr = parent;
  }

  if (fs.existsSync(curr)) {
    try {
      const realParent = fs.realpathSync(curr);
      return tailSegments.length > 0 ? path.join(realParent, ...tailSegments) : realParent;
    } catch {
      return resolvedTarget;
    }
  }

  return resolvedTarget;
}

export function isDenied(targetPath, repoRoot = process.cwd(), customDenyList = null) {
  if (!targetPath) return true;

  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(repoRoot);

  let realRoot = resolvedRoot;
  try {
    if (fs.existsSync(resolvedRoot)) {
      realRoot = fs.realpathSync(resolvedRoot);
    }
  } catch {
    realRoot = resolvedRoot;
  }

  const realTarget = resolveNearestRealPath(resolvedTarget);

  const rawHome = os.homedir();
  let realHome = rawHome;
  try {
    if (fs.existsSync(rawHome)) {
      realHome = fs.realpathSync(rawHome);
    }
  } catch {
    realHome = rawHome;
  }

  const targetCmp = IS_CASE_INSENSITIVE ? realTarget.toLowerCase() : realTarget;
  const rootCmp = IS_CASE_INSENSITIVE ? realRoot.toLowerCase() : realRoot;

  // Explicitly deny external agent configuration and runtime paths, checking both resolved and unresolved home (NF-5)
  const candidateHomes = realHome === rawHome ? [rawHome] : [rawHome, realHome];
  for (const homeDir of candidateHomes) {
    const evolveDir = path.join(homeDir, '.aos', 'evolve');
    const evolveCmp = IS_CASE_INSENSITIVE ? evolveDir.toLowerCase() : evolveDir;

    for (const forbiddenDir of ['.agents', '.claude', '.aos']) {
      const forbiddenPath = path.join(homeDir, forbiddenDir);
      const forbiddenCmp = IS_CASE_INSENSITIVE ? forbiddenPath.toLowerCase() : forbiddenPath;

      if (forbiddenDir === '.aos') {
        // Allow ~/.aos/evolve storage and runtime directory, protect everything else under ~/.aos
        if (targetCmp === evolveCmp || targetCmp.startsWith(evolveCmp + path.sep)) {
          continue;
        }
      }

      if (targetCmp === forbiddenCmp || targetCmp.startsWith(forbiddenCmp + path.sep)) {
        return true;
      }
    }
  }

  // Deny escaping repository root
  if (IS_CASE_INSENSITIVE) {
    if (targetCmp !== rootCmp && !targetCmp.startsWith(rootCmp.endsWith(path.sep) ? rootCmp : rootCmp + path.sep)) {
      return true;
    }
  }

  const relFromRoot = path.relative(realRoot, realTarget);
  if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) {
    return true;
  }

  let denyPatterns = customDenyList;
  if (!denyPatterns) {
    const trustRootDenyFile = getTrustRootDenyListPath();
    if (!fs.existsSync(trustRootDenyFile)) {
      // Fail closed: if trust-root deny list is missing, access is denied
      return true;
    }
    try {
      denyPatterns = loadDenyList(trustRootDenyFile);
    } catch {
      // Fail closed on parse or read error
      return true;
    }
  }

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
