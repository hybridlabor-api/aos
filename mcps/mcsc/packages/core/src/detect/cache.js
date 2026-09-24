import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CACHE_DIR = join(homedir(), '.config', 'mcsc');
const CACHE_FILE = join(CACHE_DIR, 'capabilities.json');

/**
 * @param {string} cliId
 * @returns {Promise<import('./types.js').CliHealth | null>}
 */
export const getCached = async (cliId) => {
  try {
    const data = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
    if (!data[cliId]) return null;
    const entry = data[cliId];
    const now = Date.now(); // must match setCached's Date.now() — performance.now() is a different clock (process-uptime-relative)
    if (now - entry.timestamp > entry.ttl) {
      delete data[cliId];
      await writeFile(CACHE_FILE, JSON.stringify(data, null, 2));
      return null;
    }
    return entry.health;
  } catch {
    return null;
  }
};

/**
 * @param {string} cliId
 * @param {import('./types.js').CliHealth} health
 * @param {number} ttlMs
 */
export const setCached = async (cliId, health, ttlMs) => {
  try {
    const data = {};
    try {
      const existing = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
      Object.assign(data, existing);
    } catch {}
    data[cliId] = { health, timestamp: Date.now(), ttl: ttlMs };
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch {
    // cache write failure is non-fatal
  }
};