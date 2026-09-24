#!/usr/bin/env node

// NOTE: an earlier draft of this file used a `node:module` loader hook
// (`register()`) to monkey-patch detect/inventory.js and detect/cache.js at
// import time instead of fixing their actual bugs (a dead `CliHealth` runtime
// import, and wrong-module imports for `homedir`/`performance`). That hack
// is gone — those files are fixed directly (they're our own code, not a
// vendor CLI wrapper, so "wrap don't patch" §7 doesn't apply here).

async function run() {
  const fs = (await import('fs')).default;
  const path = (await import('path')).default;
  const os = (await import('os')).default;
  const { fileURLToPath } = await import('url');

  const { loadRulebook } = await import('../src/rulebook/load.js');
  const { decide } = await import('../src/rulebook/resolve.js');
  const { runInventory } = await import('../src/detect/inventory.js');
  const { getCached, setCached } = await import('../src/detect/cache.js');
  const { buildOfferTable } = await import('../src/capabilities/buildOfferTable.js');

  const { delegate: agyDelegate } = await import('../src/adapters/agy.js');
  const { delegate: opencodeDelegate } = await import('../src/adapters/opencode.js');
  const { delegate: nativeDelegate } = await import('../src/adapters/native.js');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const CLI_IDS = ['agy', 'opencode', 'codex', 'native'];
  const TTL_MS = 24 * 60 * 60 * 1000;

  async function getInventory() {
    const cliHealthMap = new Map();
    const missingCliIds = [];

    for (const cliId of CLI_IDS) {
      const cached = await getCached(cliId);
      if (cached) {
        cliHealthMap.set(cliId, cached);
      } else {
        missingCliIds.push(cliId);
      }
    }

    if (missingCliIds.length > 0) {
      const newHealthMap = await runInventory({ cliIds: missingCliIds, maxAgeMs: TTL_MS });
      for (const [cliId, health] of newHealthMap.entries()) {
        cliHealthMap.set(cliId, health);
        await setCached(cliId, health, TTL_MS);
      }
    }

    return cliHealthMap;
  }

  const argv = process.argv;
  const subcommand = argv[2];

  let taskType = null;
  let promptText = null;
  let isJson = false;

  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === '--task-type' && i + 1 < argv.length) {
      taskType = argv[++i];
    } else if (argv[i] === '--prompt' && i + 1 < argv.length) {
      promptText = argv[++i];
    } else if (argv[i] === '--json') {
      isJson = true;
    }
  }

  if (subcommand === 'detect') {
    const inventoryMap = await getInventory();
    const inventoryObj = Object.fromEntries(inventoryMap);
    if (isJson) {
      console.log(JSON.stringify(inventoryObj, null, 2));
    } else {
      console.log(inventoryObj);
    }
    return;
  }

  if (subcommand === 'route' || subcommand === 'exec') {
    const inventoryMap = await getInventory();
    
    const defaultsPath = path.resolve(__dirname, '../rulebook.default.yaml');
    const overridePath = path.resolve(os.homedir(), '.config/mcsc/rulebook.yaml');
    
    let rules = [];
    try {
      rules = await loadRulebook({
        defaultsPath,
        overridePath: fs.existsSync(overridePath) ? overridePath : undefined
      });
    } catch (e) {
      console.error('Failed to load rulebook:', e);
      process.exit(1);
    }

    const now = Date.now();
    const offerTable = await buildOfferTable(rules, inventoryMap, now);
    
    const inventorySnapshot = { cliHealth: Object.fromEntries(inventoryMap) };
    const taskDescriptor = { task_type: taskType };
    
    const decision = decide(taskDescriptor, rules, inventorySnapshot, offerTable, now);
    
    if (subcommand === 'route') {
      if (isJson) {
        console.log(JSON.stringify(decision, null, 2));
      } else {
        console.log(decision);
      }
      if (decision.kind === 'refuse') {
        process.exit(1);
      }
      return;
    }

    if (subcommand === 'exec') {
      if (decision.kind === 'refuse') {
        console.error(JSON.stringify(decision, null, 2));
        process.exit(1);
      }

      if (decision.kind === 'route') {
        const delegateReq = {
          taskType,
          prompt: promptText,
          model: decision.offer.modelId,
          cwd: process.cwd()
        };

        let result;
        try {
          if (decision.cliId === 'agy') {
            result = await agyDelegate(delegateReq);
          } else if (decision.cliId === 'opencode') {
            result = await opencodeDelegate(delegateReq);
          } else if (decision.cliId === 'native') {
            result = await nativeDelegate(delegateReq);
          } else {
            console.error('No adapter for CLI:', decision.cliId);
            process.exit(1);
          }

          console.log(result.output);
          process.exit(result.exit);
        } catch (e) {
          console.error(e);
          process.exit(1);
        }
      }
    }
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
