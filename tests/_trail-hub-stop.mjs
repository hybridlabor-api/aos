import { spawnSync } from 'node:child_process';

export const portRange = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

// Stop the trail-hub.mjs processes of a test, found by port. `--ensure` starts the hub detached, so the test has
// to stop it. Never a generic match: win32 matches the exact command line "... trail-hub.mjs --port <p>",
// POSIX uses the listener of that port (lsof).
export function stopTrailHubs(ports) {
  const list = [...new Set(ports.map(Number).filter(Number.isInteger))];
  if (!list.length) return;
  if (process.platform === 'win32') {
    const conds = list.map((p) => `$_.CommandLine -like '*trail-hub.mjs --port ${p}'`).join(' -or ');
    const ps = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { ${conds} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
    spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
    return;
  }
  for (const p of list) {
    const r = spawnSync('lsof', ['-ti', `tcp:${p}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    for (const pid of (r.stdout || '').split(String.fromCharCode(10)).filter(Boolean)) { if (Number(pid) !== process.pid) try { process.kill(Number(pid)); } catch {} }
  }
}
