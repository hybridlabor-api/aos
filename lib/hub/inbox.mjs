import { join, dirname } from 'node:path';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function getWatchesFile(home) {
  return join(home, '.aos', 'hub', 'watches.json');
}

function getInboxLogFile(home) {
  return join(home, '.aos', 'hub', 'inbox.log');
}

export function readWatches(home) {
  const f = getWatchesFile(home);
  try {
    const data = readFileSync(f, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export function writeWatches(home, watches) {
  const f = getWatchesFile(home);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(watches, null, 2), { mode: 0o600 });
}

export function addWatch(home, watchDef) {
  const watches = readWatches(home);
  if (!watchDef.id) watchDef.id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const existingIndex = watches.findIndex(w => w.id === watchDef.id);
  if (existingIndex !== -1) {
    watches[existingIndex] = { ...watches[existingIndex], ...watchDef };
  } else {
    watches.push(watchDef);
  }
  writeWatches(home, watches);
  return watchDef;
}

export function removeWatch(home, id) {
  const watches = readWatches(home);
  const filtered = watches.filter(w => w.id !== id);
  writeWatches(home, filtered);
}

export async function tickWatches(home, rootDir) {
  const watches = readWatches(home);
  if (watches.length === 0) return;
  let changed = false;

  for (const watch of watches) {
    try {
      // Execute the read tool through gateway
      const args = JSON.stringify(watch.readArgs || {});
      const target = `${watch.upstream}/${watch.readTool}`;

      const gatewayBin = join(rootDir, 'bin', 'aos-gateway.mjs');
      let gwRes;
      try {
        gwRes = await execFileAsync(process.execPath, [gatewayBin, 'run', target, '--args', args], {
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, HOME: home }
        });
      } catch (e) {
         console.error("Gateway run failed. Status:", e.code);
         console.error("Gateway stdout:", e.stdout);
         console.error("Gateway stderr:", e.stderr);
         continue;
      }

      // Parse output. It is usually JSON if the tool returns JSON, but we assume it's MCP tool result format
      // Gateway run wraps 1mcp run. The output of 1mcp run is the JSON string of the result.
      // E.g. {"content":[{"type":"text","text":"[{\"id\":...}]"}]}
      let resJson;
      try {
        // the gateway output might have a single json object or an array. 1mcp run returns an object with a content array.
        const output = gwRes.stdout.trim();
        // find last line or full body
        resJson = JSON.parse(output.split('\n').pop());
      } catch (err) {
        console.error('Failed to parse gateway output', gwRes.stdout);
        console.error(err);
        console.error("gateway error stream:", gwRes.stderr);
        continue;
      }

      let items = [];
      if (resJson && resJson.content && resJson.content.length > 0) {
        const textContent = resJson.content.find(c => c.type === 'text')?.text;
        if (textContent) {
          try {
            const parsed = JSON.parse(textContent);
            if (Array.isArray(parsed)) {
              items = parsed;
            } else if (parsed && Array.isArray(parsed.items)) {
              items = parsed.items;
            } else if (parsed) {
              items = [parsed];
            }
          } catch {
             // Not JSON array inside text
          }
        }
      } else if (Array.isArray(resJson)) {
        items = resJson;
      } else if (resJson && Array.isArray(resJson.items)) {
        items = resJson.items;
      }

      const cursorField = watch.cursorField;
      if (!cursorField) continue;

      const newCursor = watch.cursor;
      let latestCursor = newCursor;

      const newItems = [];
      for (const item of items) {
         if (item[cursorField]) {
            if (latestCursor === undefined || item[cursorField] > latestCursor) {
               newItems.push(item);
            }
         }
      }

      if (newItems.length > 0) {
         // Update latest cursor
         let maxItemCursor = latestCursor;
         for (const item of newItems) {
            const val = item[cursorField];
            if (maxItemCursor === undefined || val > maxItemCursor) {
               maxItemCursor = val;
            }
         }
         watch.cursor = maxItemCursor;
         changed = true;

         // Deliver items
         for (const item of newItems) {
            await deliverItem(home, rootDir, watch, item);
         }

         // Optional typing/ack tool
         if (watch.ackTool) {
             const ackArgs = JSON.stringify(watch.ackArgs || {});
             const ackTarget = `${watch.upstream}/${watch.ackTool}`;
             try {
                await execFileAsync(process.execPath, [gatewayBin, 'run', ackTarget, '--args', ackArgs], {
                    encoding: 'utf8',
                    env: { ...process.env, HOME: home }
                });
             } catch (e) {
                // ignore
             }
         }
      }
    } catch (e) {
      // Ignore tick errors
    }
  }

  if (changed) {
    writeWatches(home, watches);
  }
}

async function deliverItem(home, rootDir, watch, item) {
  const logFile = getInboxLogFile(home);
  mkdirSync(dirname(logFile), { recursive: true });

  const textMsg = item.text || item.message || JSON.stringify(item);
  const time = new Date().toISOString();

  // Log it
  const logLine = `[${time}] Watch ${watch.id} (${watch.upstream}): length ${textMsg.length}${watch.logBodies ? ` body: ${textMsg}` : ''}\n`;
  appendFileSync(logFile, logLine);

  let deliveredA2a = false;
  if (watch.deliverTo) {
      // Try aos-a2a send --to
      try {
        const a2aBin = join(rootDir, 'bin', 'aos-a2a.mjs');
        // We only check if the peer is live. We can use aos-a2a list --json and see if it's there
        let listRes;
        try {
            listRes = await execFileAsync(process.execPath, [a2aBin, 'list', '--json'], { encoding: 'utf8', env: { ...process.env, HOME: home } });
            const peers = JSON.parse(listRes.stdout);
            const peer = peers.find(p => p.name === watch.deliverTo || p.fileName === watch.deliverTo);
            if (peer) {
               try {
                   await execFileAsync(process.execPath, [a2aBin, 'send', '--to', watch.deliverTo, textMsg], { encoding: 'utf8', env: { ...process.env, HOME: home } });
                   deliveredA2a = true;
               } catch (e) {
                   // failed to send
               }
            }
        } catch (e) {
           // failed list
        }
      } catch (err) {
        // failed A2A
      }
  }

  if (!deliveredA2a) {
      const title = `New message via ${watch.upstream}`;
      const msgPreview = textMsg.substring(0, 100).replace(/\r|\n/g, ' ');
      try {
         if (process.platform === 'darwin') {
            // pass as arg 1 instead of inside the script to avoid injection
            await execFileAsync('osascript', ['-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title (item 2 of argv)', '-e', 'end run', msgPreview, title]);
         } else if (process.platform === 'linux') {
            await execFileAsync('notify-send', [title, msgPreview]);
         } else if (process.platform === 'win32') {
            // powershell encoded command to avoid parsing issues
            const b64 = Buffer.from(msgPreview, 'utf16le').toString('base64');
            const tb64 = Buffer.from(title, 'utf16le').toString('base64');
            const psCmd = `New-BurntToastNotification -Text ([System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('${tb64}'))), ([System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('${b64}')))`;
            const encoded = Buffer.from(psCmd, 'utf16le').toString('base64');
            await execFileAsync('powershell', ['-EncodedCommand', encoded]);
         }
      } catch (e) {
         // ignore notification error
      }
  }
}
