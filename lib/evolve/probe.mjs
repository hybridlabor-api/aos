import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProbe } from './probe-load.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export function runProbes(opts = {}) {
  const home = opts.home || process.env.HOME || os.homedir();
  const evolveDir = path.join(home, '.aos', 'evolve');
  const resultsFile = path.join(evolveDir, 'probe_results.json');

  const target = opts.target;
  let probePaths = opts.probePaths;

  if (!probePaths) {
     const setParam = opts.set || 'default';
     let setFilePath = setParam.endsWith('.json') ? setParam : `${setParam}.json`;
     let resolvedSetPath = path.resolve(setFilePath);
     if (!fs.existsSync(resolvedSetPath)) {
       resolvedSetPath = path.join(REPO_ROOT, 'evolve', 'probes', setFilePath);
     }
     if (!fs.existsSync(resolvedSetPath)) {
       return { ok: false, error: `Probe set file not found: ${setParam}` };
     }
     try {
       probePaths = JSON.parse(fs.readFileSync(resolvedSetPath, 'utf8')).map(p => path.resolve(path.dirname(resolvedSetPath), p));
     } catch (err) {
       return { ok: false, error: `Failed to read probe set file: ${err.message}` };
     }
  }

  let prevResults = {};
  if (fs.existsSync(resultsFile)) {
    try {
      prevResults = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    } catch (e) {}
  }

  const results = {};
  const regressions = [];
  let targetImproved = false;
  let targetFound = false;

  for (const probeDir of probePaths) {
    if (!fs.existsSync(probeDir)) {
      return { ok: false, error: `Probe directory missing: ${path.basename(probeDir)}` };
    }

    let def;
    try {
      const loader = opts.loadProbe || loadProbe;
      def = loader(probeDir, opts);
    } catch (e) {
      return { ok: false, error: `Failed to load probe at ${path.basename(probeDir)}: ${e.message}` };
    }

    const pid = def.probe.id;
    const repeats = def.probe.repeats || 3;
    let score = 0;
    let runs = 0;

    for (let i = 0; i < repeats; i++) {
      try {
        const execFn = opts.execFileSync || execFileSync;
        const out = execFn(process.execPath, [def.checkerPath], { cwd: def.probeDir, encoding: 'utf8' });
        const parsed = JSON.parse(out);
        score += parsed.score || 0;
      } catch (e) {
        // failed run counts as 0 score
      }
      runs++;
    }

    const avgScore = runs > 0 ? score / runs : 0;
    results[pid] = avgScore;

    const prevScore = prevResults[pid] !== undefined ? prevResults[pid] : 0;

    if (avgScore < prevScore) {
      regressions.push(pid);
    }

    if (target && pid === target) {
      targetFound = true;
      if (avgScore > prevScore || (avgScore === 1.0 && prevScore < 1.0)) {
        targetImproved = true;
      }
    }
  }

  if (target && !targetFound) {
    return { ok: false, error: `Target probe '${target}' was not found in the run set.`, regressions, results };
  }

  if (regressions.length > 0) {
    return {
      ok: false,
      error: `Regression in probes: ${regressions.join(', ')}`,
      regressions,
      results
    };
  }

  if (target && !targetImproved) {
    return {
      ok: false,
      error: `Target probe '${target}' did not improve.`,
      regressions,
      results
    };
  }

  if (!opts.dryRun) {
    fs.mkdirSync(evolveDir, { recursive: true });
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2), 'utf8');
  }

  return { ok: true, results, regressions };
}
