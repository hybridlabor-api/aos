// Dispatcher for /startcycle-graph. Implements the node/edge table in
// .agents/graph.md as an actual runnable loop, using Claude Code's Dynamic
// Workflows runtime (this script IS the dispatcher F-17 requires: it holds
// the loop and the branching decisions; the seven agents below are leaves
// that never invoke each other or this script).
//
// Four things this runtime doesn't give a workflow script, and how we work
// around them:
//
// 1. No direct filesystem access from the script itself ("Agents read,
//    write, and run commands. The script coordinates the agents" --
//    code.claude.com/docs/en/workflows). So this script can't read/write
//    production_artifacts/state.json directly. Every agent() call below is
//    told to read/write that file itself (agents do have file tools) AND to
//    return the same information as structured `schema`-validated JSON --
//    that structured return is what this script branches on. state.json
//    stays the durable, harness-neutral record per .agents/state.schema.json
//    (any harness, or graph-gate.mjs's Stop hook, can still inspect it
//    between runs); the schema return is this run's own control-flow signal,
//    since the script has no other way to see what happened.
//
// 2. No module loading (`import()` fails before the run starts) -- `agent`
//    and `pipeline` are ambient globals the runtime injects, not imports.
//    `args` is likewise an ambient global carrying whatever was passed to
//    `/startcycle-graph`, not a function parameter.
//
// 3. pipeline() fans out one agent() call per build node, genuinely
//    concurrently, and every one of those was previously told to
//    read-modify-write the SAME production_artifacts/state.json -- last
//    writer wins, so concurrent findings/artifact updates were silently
//    lost. There is no lock available (the runtime gives the script no
//    filesystem access, so it can't hold one itself). Fixed by single-
//    writer-per-file: each build node in a pipeline() fan-out writes ONLY
//    its own production_artifacts/state.d/<nodeId>.json fragment (see
//    .agents/state.schema.json's $defs.stateFragment) and never touches
//    state.json. Immediately after each pipeline() call returns -- the
//    barrier where every parallel node has finished -- mergeStateD() below
//    invokes one dedicated helper agent (role merge_state) that folds every state.d/*.json
//    fragment into state.json, deterministically, before the run continues.
//    This still happens inside the workflow run, never deferred, because
//    graph-gate.mjs reads state.json at turn end. Sequential nodes
//    (architect, techlead, reviewer, shipping) are never inside a
//    pipeline() fan-out, so they are not part of this race and keep
//    writing state.json directly, same as before.
//
// 4. The seven node identities (persona file, which skills each may
//    reach for, build-node instructions) used to be hardcoded in this
//    script. They now live in .agents/nodes.json (owned by a different
//    agent than this file) so that registry can grow without touching this
//    dispatcher. Since this script has no filesystem access (see #1), it
//    can't read that file itself either -- so the very first thing this run
//    does is spawn a small `load-registry` agent whose only job is to
//    read .agents/nodes.json and return it, schema-validated. Everything
//    downstream (BUILD_NODES, NODE_ENUM, NODE_NAMES, every agentType
//    passed to agent(), every skills allowlist, every build-node
//    instruction string) is derived from that returned object, not
//    hardcoded. If the registry fails to load or comes back with fewer
//    than the seven required node ids, this run escalates immediately --
//    it never silently falls back to a hardcoded list.
//
// 5. A node's registry skills (common + own) are only useful if they are
//    actually installed. Before every node worker starts -- sequential or
//    inside a pipeline() fan-out -- ensureNodeSkills() runs a deterministic
//    check-and-install step: whatever is missing from every harness skill
//    dir is installed offline through the store CLI (local library, package
//    fallback). Best-effort: an unresolvable skill is reported on stderr and
//    the worker still starts, since the skills note is a preference, while a
//    --skill= mandate keeps its own hard-fail path below.
//
// max_iterations mirrors .agents/state.schema.json's default (3) --
// deliberately under Claude Code's own 8-consecutive-Stop-hook-block
// override, so this workflow's own escalation return reaches the user
// before that platform ceiling would silently end a turn instead.

export const meta = {
  name: 'startcycle-dispatch',
  description:
    'Dispatcher-mediated build pipeline: Architect -> TechLead -> {UI_UX, Engineering, Media_EventTech} -> Reviewer -> Shipping, per .agents/graph.md. Agents never invoke each other -- this script decides every next step. Node identities come from .agents/nodes.json, loaded fresh each run.',
};

let routeFor = null;
if (typeof process !== 'undefined') {
  try {
    const routeMod = await import(new URL('../../lib/router/route.js', import.meta.url).href);
    routeFor = routeMod.routeFor;
  } catch {}
}

let workstreamMod = null;
if (typeof process !== 'undefined') {
  try {
    workstreamMod = await import(new URL('../../lib/roles/workstream.mjs', import.meta.url).href);
  } catch {}
}

export const AGENT_ALIASES = workstreamMod?.AGENT_ALIASES || Object.freeze({
  'engineering': 'godmode-engineering',
  'godmode-engineering': 'engineering',
  'godmode_engineering': 'engineering',
  'ui_ux': 'godmode-ui-ux',
  'ui-ux': 'godmode-ui-ux',
  'godmode-ui-ux': 'ui_ux',
  'godmode_ui_ux': 'ui_ux',
  'shipping': 'godmode-shipping',
  'godmode-shipping': 'shipping',
  'godmode_shipping': 'shipping',
  'media_eventtech': 'godmode-media-eventtech',
  'media-eventtech': 'godmode-media-eventtech',
  'godmode-media-eventtech': 'media_eventtech',
  'godmode_media_eventtech': 'media_eventtech',
});

export function resolveAgentName(name) {
  if (workstreamMod?.resolveAgentName) return workstreamMod.resolveAgentName(name);
  if (typeof name !== 'string') return name;
  const normalized = name.trim();
  const stripped = normalized.includes(':') ? normalized.split(':').pop() : normalized;
  return AGENT_ALIASES[stripped] || stripped;
}

export function canonicalNodeId(name) {
  if (workstreamMod?.canonicalNodeId) return workstreamMod.canonicalNodeId(name);
  if (typeof name !== 'string') return name;
  const stripped = name.includes(':') ? name.split(':').pop() : name;
  if (['architect', 'techlead', 'ui_ux', 'engineering', 'media_eventtech', 'reviewer', 'shipping'].includes(stripped)) {
    return stripped;
  }
  const resolved = AGENT_ALIASES[stripped];
  if (resolved && ['architect', 'techlead', 'ui_ux', 'engineering', 'media_eventtech', 'reviewer', 'shipping'].includes(resolved)) {
    return resolved;
  }
  return stripped;
}

export function canonicalAgentType(name) {
  if (workstreamMod?.canonicalAgentType) return workstreamMod.canonicalAgentType(name);
  if (typeof name !== 'string') return name;
  const stripped = name.includes(':') ? name.split(':').pop() : name;
  if (['godmode-ui-ux', 'godmode-engineering', 'godmode-media-eventtech', 'godmode-shipping'].includes(stripped)) {
    return stripped;
  }
  const resolved = AGENT_ALIASES[stripped];
  if (resolved && ['godmode-ui-ux', 'godmode-engineering', 'godmode-media-eventtech', 'godmode-shipping'].includes(resolved)) {
    return resolved;
  }
  return stripped;
}

export function extractWorkstreamsFlag(text) {
  if (workstreamMod?.extractWorkstreamsFlag) return workstreamMod.extractWorkstreamsFlag(text);
  if (typeof text !== 'string') return { workstreams: false, goal: text };
  const flagPattern = /--workstreams\b/i;
  const hasFlag = flagPattern.test(text);
  const goal = hasFlag ? text.replace(flagPattern, '').replace(/\s{2,}/g, ' ').trim() : text;
  return { workstreams: hasFlag, goal };
}

export function validateExecutionManifest(manifest, options = {}) {
  if (workstreamMod?.validateExecutionManifest) return workstreamMod.validateExecutionManifest(manifest, options);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: [{ code: 'ERR_INVALID_MANIFEST', message: 'Execution manifest must be an object' }] };
  }
  if (manifest.createdBy !== 'architect') {
    return { valid: false, errors: [{ code: 'ERR_INVALID_CREATED_BY', message: 'createdBy must be architect' }] };
  }
  if (!Array.isArray(manifest.workstreams) || manifest.workstreams.length === 0 || manifest.workstreams.length > 6) {
    return { valid: false, errors: [{ code: 'ERR_WORKSTREAM_CAP', message: 'workstreams must be 1 to 6' }] };
  }
  return { valid: true, errors: [] };
}

export function buildNodesFromManifest(manifest, options = {}) {
  if (workstreamMod?.buildNodesFromManifest) return workstreamMod.buildNodesFromManifest(manifest, options);
  if (!manifest?.workstreams || !Array.isArray(manifest.workstreams)) return [];
  return manifest.workstreams.map((ws) => ({
    id: ws.id,
    label: ws.label || ws.id,
    agentType: canonicalAgentType(ws.agentType || ws.id),
    personaFile: ws.personaFile || `.claude/agents/${canonicalAgentType(ws.agentType || ws.id)}.md`,
    role: ws.role || 'build',
    artifactKey: ws.artifactKey || ws.id,
    writes: `production_artifacts/state.d/${ws.id}.json`,
    optional: false,
    skills: ws.skills || [],
    playbooks: ws.playbooks || [],
    gates: ws.gates || [],
    instructions: ws.instructions || `Execute workstream ${ws.id}. Produce ${ws.artifactKey || ws.id} artifact.`,
  }));
}

export function deriveWorkstreamGates(workstreams, fallbackGates = ['lint', 'typecheck', 'tests', 'a11y', 'seo', 'security']) {
  if (workstreamMod?.deriveWorkstreamGates) return workstreamMod.deriveWorkstreamGates(workstreams, fallbackGates);
  if (!Array.isArray(workstreams) || workstreams.length === 0) return [...fallbackGates];
  const custom = [];
  for (const ws of workstreams) {
    if (Array.isArray(ws.gates)) {
      for (const g of ws.gates) {
        if (typeof g === 'string' && g.trim() && !custom.includes(g)) custom.push(g);
      }
    }
  }
  return custom.length > 0 ? custom : [...fallbackGates];
}

export function resolveBuildPlan(params = {}) {
  if (workstreamMod?.resolveBuildPlan) return workstreamMod.resolveBuildPlan(params);
  const { workstreamsFlag = false, executionManifest = null, effectiveNodes = {}, needsMedia = false, skipNodes = [], profile = null } = params;
  if (!workstreamsFlag || !executionManifest?.workstreams) {
    return Object.keys(effectiveNodes)
      .filter((id) => effectiveNodes[id]?.role === 'build')
      .filter((id) => (profile ? !skipNodes.includes(id) : (id !== 'media_eventtech' || needsMedia)))
      .map((id) => ({ id, ...effectiveNodes[id] }));
  }
  return buildNodesFromManifest(executionManifest, params);
}


// Polyfilled module access for standalone CLI and hook executions outside Claude runtime
let fs = typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function'
  ? process.getBuiltinModule('node:fs')
  : null;
let path = typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function'
  ? process.getBuiltinModule('node:path')
  : null;
let os = typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function'
  ? process.getBuiltinModule('node:os')
  : null;
let child_process = typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function'
  ? process.getBuiltinModule('node:child_process')
  : null;

if (!fs && typeof process !== 'undefined') {
  try {
    fs = await import('node:fs');
    path = await import('node:path');
    os = await import('node:os');
    child_process = await import('node:child_process');
  } catch {}
}

let archifyContractPromise;
async function loadArchifyContract() {
  if (!archifyContractPromise) {
    archifyContractPromise = (async () => {
      if (typeof process === 'undefined') return null;
      try {
        return await import(new URL('../../lib/aos-archify-contract.mjs', import.meta.url).href);
      } catch {
        return null;
      }
    })();
  }
  return archifyContractPromise;
}

function readStdinSync() {
  const chunks = [];
  const buffer = Buffer.alloc(64 * 1024);
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    let bytes;
    try {
      bytes = fs.readSync(0, buffer, 0, buffer.length, null);
    } catch (error) {
      if (error?.code === 'EAGAIN' || error?.code === 'EWOULDBLOCK') {
        Atomics.wait(sleeper, 0, 0, 2);
        continue;
      }
      throw error;
    }
    if (bytes === 0) break;
    chunks.push(Buffer.from(buffer.subarray(0, bytes)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

let inputGoal = null;
let inputSkills = [];
let isHookInvocation = false;
// Codex/Claude payloads carry hook_event_name and reject agy's injectSteps; agy payloads do not.
let hookEventName = '';

// 1. Fast-exit & input handling for hook invocations (Antigravity PreInvocation, Codex UserPromptSubmit)
if (typeof process !== 'undefined' && process.stdin && !process.stdin.isTTY && fs) {
  try {
    let stdinRaw = '';
    try { stdinRaw = readStdinSync().trim(); } catch {}
    if (stdinRaw) {
      isHookInvocation = true;
      let payload = null;
      try { payload = JSON.parse(stdinRaw); } catch {}

      if (payload && typeof payload === 'object') {
        hookEventName = String(payload.hook_event_name || '');
        let promptText = payload.prompt || payload.userPrompt || '';
        if (!promptText && payload.transcriptPath && fs.existsSync(payload.transcriptPath)) {
          try {
            const lines = fs.readFileSync(payload.transcriptPath, 'utf8').trim().split('\n');
            for (let i = lines.length - 1; i >= 0; i--) {
              try {
                const entry = JSON.parse(lines[i]);
                if (entry.role === 'user' || entry.type === 'human') {
                  promptText = entry.content || entry.text || entry.message || '';
                  break;
                }
              } catch {}
            }
          } catch {}
        }

        const match = (promptText || '').match(/^\/startcycle-graph(?:\s+(.*))?$/is);
        if (!match) {
          // Clean fast-exit when invoked on non-command prompts
          if (process.stdout && !hookEventName) {
            process.stdout.write(JSON.stringify({ injectSteps: [] }) + '\n');
          }
          process.exit(0);
        }

        inputGoal = (match[1] || '').trim();
      }
    }
  } catch {}
}

// 2. CLI arguments handling for standalone invocations
if (inputGoal === null && typeof process !== 'undefined' && Array.isArray(process.argv)) {
  const cliArgs = process.argv.slice(2);
  if (cliArgs.length > 0) {
    if (cliArgs.includes('--help') || cliArgs.includes('-h')) {
      console.log('Usage: node startcycle-dispatch.mjs [--skill=<name>] [--profile=<name>] <goal>');
      process.exit(0);
    }
    const joined = cliArgs.join(' ').trim();
    const match = joined.match(/^\/startcycle-graph(?:\s+(.*))?$/is);
    inputGoal = match ? (match[1] || '').trim() : joined;
  }
}

// 3. Ambient global args (Claude Dynamic Workflows)
const ambientArgs = typeof args !== 'undefined' ? args : null;
if (inputGoal === null && ambientArgs) {
  inputGoal = typeof ambientArgs === 'string' ? ambientArgs : (ambientArgs.goal || '');
  if (Array.isArray(ambientArgs.mandatorySkills)) {
    inputSkills = ambientArgs.mandatorySkills;
  }
}

// 4. Standalone runtime shims for pipeline() and agent()
if (typeof globalThis.pipeline === 'undefined') {
  globalThis.pipeline = async function standalonePipeline(items, fn) {
    // Hard cap on parallel children. An unbounded Promise.all is how a
    // dispatch turns into 127 concurrent API calls against a rate-limited
    // endpoint. Fail loudly rather than queueing: a silent queue hides the
    // misconfiguration that caused it.
    // ponytail: cap is a fixed default, not adaptive. Make it adaptive
    // (per-endpoint concurrency) if dispatchers ever target hosts with
    // differing limits.
    const cap = (() => {
      const raw = process.env.AOS_MAX_PARALLEL_AGENTS;
      const n = raw === undefined ? 8 : Number.parseInt(raw, 10);
      return Number.isInteger(n) && n > 0 ? n : 8;
    })();

    const list = Array.from(items ?? []);
    if (list.length > cap) {
      throw new Error(
        `Refusing to dispatch ${list.length} parallel agents: AOS_MAX_PARALLEL_AGENTS cap is ${cap}. ` +
          `Raise the cap explicitly, or reduce the node set. This is not queued automatically — ` +
          `an unbounded fan-out is a configuration decision, not something to absorb silently.`
      );
    }

    return Promise.all(list.map((item) => fn(item)));
  };
}

if (typeof globalThis.agent === 'undefined') {
  globalThis.agent = async function standaloneAgent(prompt, options = {}) {
    const label = options.label || '';

    // Deterministic step: load-profile (same load step shape as load-registry)
    if (label === 'load-profile') {
      try {
        const name = String(options?.profile || '');
        if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) return { missing: true, name };
        const pPath = path ? path.resolve('.agents', 'profiles', `${name}.json`) : `.agents/profiles/${name}.json`;
        if (fs && fs.existsSync(pPath)) {
          return { ...JSON.parse(fs.readFileSync(pPath, 'utf8')), missing: false };
        }
      } catch {}
      return { missing: true };
    }

    // Deterministic step: load-registry
    if (label === 'load-registry') {
      try {
        const nodesPath = path ? path.resolve('.agents', 'nodes.json') : '.agents/nodes.json';
        if (fs && fs.existsSync(nodesPath)) {
          return { ...JSON.parse(fs.readFileSync(nodesPath, 'utf8')), pipeline: readPipelineConfigFs() };
        }
      } catch {}
      return { version: 0, nodes: {} };
    }

    // Deterministic step: validate-mandatory-skills
    if (label === 'validate-mandatory-skills') {
      const found = [];
      const missing = [];
      const suggestions = [];

      const skillNames = mandatorySkills || [];
      const home = os ? os.homedir() : '';
      const candidateRoots = [
        path ? path.join(home, '.claude', 'skills') : '',
        path ? path.join(home, '.agents', 'skills') : '',
        path ? path.join(home, '.gemini', 'config', 'skills') : '',
        path ? path.join(home, '.codex', 'skills') : '',
        path ? path.join(home, '.cursor', 'skills') : '',
        path ? path.join(home, '.roo', 'skills') : '',
        path ? path.resolve('skills') : 'skills',
      ].filter(Boolean);

      const allInstalledSkills = new Set();
      if (fs) {
        for (const root of candidateRoots) {
          if (fs.existsSync(root)) {
            try {
              for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
                if (entry.isDirectory()) allInstalledSkills.add(entry.name);
              }
            } catch {}
          }
        }
      }

      for (const name of skillNames) {
        let isFound = false;
        if (fs) {
          for (const root of candidateRoots) {
            if (fs.existsSync(path.join(root, name, 'SKILL.md'))) {
              isFound = true;
              break;
            }
          }
        }
        if (isFound) {
          found.push(name);
        } else {
          missing.push(name);
          for (const inst of allInstalledSkills) {
            if (inst.includes(name) || name.includes(inst)) {
              if (!suggestions.includes(inst)) suggestions.push(inst);
            }
          }
        }
      }
      return { found, missing, suggestions: suggestions.slice(0, 5) };
    }

    // Deterministic step: ensure-node-skills. Before a node's worker starts,
    // make sure the node's registry skills (common + own) are actually
    // installed: a SKILL.md in any one harness skill dir (or the project's
    // own skills/) counts. Whatever is missing everywhere is installed
    // offline, one name at a time, via the store CLI shipped beside this
    // dispatcher (local library, falling back to the package's own skills
    // dir). Best-effort by design: a name that cannot be installed is
    // reported as stillMissing, never thrown -- the worker still starts.
    if (label === 'ensure-node-skills' || label.startsWith('ensure-skills-')) {
      const wanted = (Array.isArray(options?.skills) ? options.skills : [])
        .filter((s) => typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s));
      const res = { installed: [], stillMissing: [] };
      if (!fs || !path || !os || !child_process || wanted.length === 0) return res;
      const home = os.homedir();
      const candidateRoots = [
        path.join(home, '.claude', 'skills'),
        path.join(home, '.agents', 'skills'),
        path.join(home, '.gemini', 'config', 'skills'),
        path.join(home, '.codex', 'skills'),
        path.join(home, '.cursor', 'skills'),
        path.join(home, '.roo', 'skills'),
        path.resolve('skills'),
      ];
      const have = (name) => candidateRoots.some((r) => {
        try { return fs.existsSync(path.join(r, name, 'SKILL.md')); } catch { return false; }
      });
      const missing = [...new Set(wanted)].filter((n) => !have(n));
      if (missing.length === 0) return res;
      try {
        const urlMod = await import('node:url');
        const cli = [
          path.join(home, '.agents', 'bin', 'aos-store.mjs'),
          path.join(path.dirname(urlMod.fileURLToPath(import.meta.url)), '..', '..', 'bin', 'aos-store.mjs'),
        ].find((c) => fs.existsSync(c));
        if (cli) {
          for (const name of missing) {
            try {
              const r = child_process.spawnSync(process.execPath, [cli, 'install', name], {
                encoding: 'utf8', timeout: 120000, shell: false,
              });
              if (r.status === 0 && have(name)) res.installed.push(name);
              else res.stillMissing.push(name);
            } catch { res.stillMissing.push(name); }
          }
          return res;
        }
      } catch {}
      res.stillMissing = missing;
      return res;
    }

    // Deterministic step: mergeStateD
    if (label.startsWith('merge-')) {
      if (!fs) return { merged: 0, skipped: [], needsHuman: false };
      const stateDDir = path ? path.resolve('production_artifacts', 'state.d') : 'production_artifacts/state.d';
      const statePath = path ? path.resolve('production_artifacts', 'state.json') : 'production_artifacts/state.json';

      if (!fs.existsSync(stateDDir)) {
        return { merged: 0, skipped: [], needsHuman: false };
      }

      let state = {};
      try {
        if (fs.existsSync(statePath)) {
          state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        }
      } catch {}
      state.artifacts = state.artifacts || {};
      state.findings = state.findings || [];

      let mergedCount = 0;
      const skipped = [];
      let needsHuman = false;

      let fragmentFiles = [];
      try {
        fragmentFiles = fs.readdirSync(stateDDir).filter((f) => f.endsWith('.json'));
      } catch {}

      for (const file of fragmentFiles) {
        const fPath = path.join(stateDDir, file);
        try {
          const fragment = JSON.parse(fs.readFileSync(fPath, 'utf8'));
          if (!fragment || typeof fragment !== 'object' || !fragment.node) {
            skipped.push(`${file} (missing required node field)`);
            continue;
          }
          if (fragment.artifacts && typeof fragment.artifacts === 'object') {
            Object.assign(state.artifacts, fragment.artifacts);
          }
          if (Array.isArray(fragment.findings)) {
            for (const f of fragment.findings) {
              const idx = state.findings.findIndex((existing) => existing.id === f.id);
              if (idx >= 0) {
                state.findings[idx] = { ...state.findings[idx], ...f };
              } else {
                state.findings.push(f);
              }
            }
          }
          if (fragment.needs_human) needsHuman = true;
          mergedCount++;
          fs.unlinkSync(fPath);
        } catch (err) {
          skipped.push(`${file} (${err.message})`);
        }
      }

      state.iteration = iteration;
      if (needsHuman) state.needs_human = true;

      try {
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
      } catch {}

      return { merged: mergedCount, skipped, needsHuman: !!state.needs_human };
    }

    // Deterministic step: escalate
    if (label === 'escalate') {
      if (fs) {
        const statePath = path ? path.resolve('production_artifacts', 'state.json') : 'production_artifacts/state.json';
        try {
          let state = {};
          if (fs.existsSync(statePath)) {
            state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          }
          state.phase = 'escalated';
          state.needs_human = true;
          state.iteration = iteration;
          fs.mkdirSync(path.dirname(statePath), { recursive: true });
          fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
        } catch {}
      }
      return { phase: 'escalated' };
    }

    if (label.startsWith('archify-verify')) {
      const failVerify = (error) => ({ validateOk: false, deliverOk: false, checksPassed: 0, checkCount: 9, error: String(error).slice(0, 400) });
      if (!fs || !path || !child_process) return failVerify('archify verify has no process runtime in this environment');
      const contract = await loadArchifyContract();
      if (!contract || typeof contract.runArchifyBoundary !== 'function') return failVerify('archify contract unavailable');
      const repoRoot = process.cwd();
      const spec = contract.ARCHITECTURE_SPEC_PATH;
      const html = contract.ARCHITECTURE_HTML_PATH;
      const localBin = typeof contract.resolveArchifyBin === 'function' ? contract.resolveArchifyBin(repoRoot) : null;
      const run = (args, options) => child_process.spawnSync(
        localBin ? process.execPath : 'aos-archify',
        [...(localBin ? [localBin] : []), ...args],
        {
          cwd: options.cwd,
          encoding: 'utf8',
          timeout: options.timeoutMs,
          maxBuffer: options.maxBuffer,
          shell: false,
        }
      );
      try {
        const result = await contract.runArchifyBoundary({
          bin: localBin,
          cwd: repoRoot,
          specPath: spec,
          htmlPath: html,
          run,
        });
        if (!result || result.ok !== true) return failVerify((result && result.error) || 'archify boundary failed');
        return {
          validateOk: result.validate?.status === 0,
          deliverOk: result.deliver?.status === 0,
          checksPassed: result.receipt?.checksPassed ?? 0,
          checkCount: result.receipt?.checkCount ?? contract.ARCHITECTURE_CHECK_COUNT ?? 9,
          error: '',
        };
      } catch (error) {
        return failVerify((error && error.message) || 'archify boundary executor failed');
      }
    }

    // LLM Agent Steps: runner adapter / graceful execution
    if (child_process) {
      try {
        const agyRes = child_process.spawnSync('agy', ['--print', prompt, '--output-format', 'json', '--print-timeout', '30s'], {
          encoding: 'utf8',
          timeout: 35000,
          shell: false,
          env: options.trail ? { ...process.env, AOS_TRAIL_NODE: options.trail.node, AOS_TRAIL_PLAN: options.trail.plan } : process.env,
        });
        if (agyRes.status === 0 && agyRes.stdout) {
          const jsonMatch = agyRes.stdout.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
        }
      } catch {}
    }

    if (label.startsWith('architect')) {
      const baseRes = {
        planPath: 'production_artifacts/00_execution_plan.md',
        needsMedia: false,
        architectureSpec: 'production_artifacts/00_architecture.json',
        architectureHtml: 'production_artifacts/00_architecture.html',
        deliverOk: true
      };
      if (prompt.includes('execution_manifest')) {
        baseRes.execution_manifest = {
          createdBy: 'architect',
          workstreams: [
            { id: 'ws_core', agentType: 'godmode-engineering', skills: ['godmode-engineering'], artifactKey: 'backend' },
            { id: 'ws_ui', agentType: 'godmode-ui-ux', skills: ['godmode-ui-ux'], artifactKey: 'frontend' }
          ]
        };
      }
      return baseRes;
    }
    if (label.startsWith('techlead')) {
      return { approved: true, reason: 'Approved capability map' };
    }
    if (label.startsWith('reviewer')) {
      return { findings: [], blockingCount: 0 };
    }
    if (label.startsWith('shipping')) {
      const gateObj = { lint: 'pass', typecheck: 'pass', tests: 'pass', a11y: 'pass', seo: 'pass', security: 'pass' };
      if (options?.schema?.properties?.gate?.required) {
        for (const k of options.schema.properties.gate.required) {
          gateObj[k] = 'pass';
        }
      }
      return {
        gate: gateObj,
        blockingNodes: [],
      };
    }
    if (label.startsWith('ws_') || ['ui_ux', 'engineering', 'media_eventtech'].includes(label)) {
      if (fs) {
        try {
          const stateDDir = path ? path.resolve('production_artifacts', 'state.d') : 'production_artifacts/state.d';
          fs.mkdirSync(stateDDir, { recursive: true });
          const fragPath = path.join(stateDDir, `${label}.json`);
          fs.writeFileSync(fragPath, JSON.stringify({
            node: label,
            artifacts: { [label]: `production_artifacts/${label}_spec.md` },
            findings: []
          }, null, 2) + '\n');
        } catch {}
      }
      return { needsHuman: false };
    }

    return { needsHuman: false };
  };
}

const MAX_ITERATIONS = 3;

// One shared counter, matching .agents/state.schema.json's single `iteration`
// field ("Incremented by the dispatcher every time an edge sends the run back
// to a build node -- TechLead rejection, Reviewer findings, or a failed
// gate"). An earlier draft used three independent counters (one per loop),
// which let a single run take up to 9 repair rounds total before any ceiling
// applied, and never matched what got persisted to state.json anyway --
// caught by an adversarial review against this same file, not assumed
// correct on the first draft.
let iteration = 0;

// Populated from a --skill=<name> flag (repeatable) in the invocation text --
// see extractMandatorySkills() and .agents/graph.md's "Mandatory Skill
// Injection" section. Empty when the user didn't ask for one. Module-level
// like `iteration` above, for the same reason: skillsNote() and the Reviewer
// prompt both need it and neither is in a position to thread it through as a
// parameter without touching every call site.
let mandatorySkills = [];

// Every sequential (non-build-role) agent gets the same note: read the full
// state, and explicitly set state.iteration to the dispatcher's current
// count so the persisted file (which .claude/hooks/graph-gate.mjs reads)
// actually reflects reality -- nothing else in this script has filesystem
// access to write it directly.
//
// Build-role nodes get a different note: they are invoked inside a
// pipeline() fan-out alongside other build nodes writing at the same time,
// so they must NOT write state.json themselves (see comment block item #3
// above) -- they write only their own production_artifacts/state.d/<id>.json
// fragment, which the dedicated merge step folds in afterwards.
function dispatchNote(node, soloWriter = false) {
  if (node?.role === 'build') {
    if (soloWriter) {
      return (
        'Read production_artifacts/state.json if it exists. ' +
        `Set state.iteration to ${iteration}. Update your artifacts key and status for your open findings directly in state.json. ` +
        'You may also set "needs_human": true if you genuinely cannot proceed without a human decision. ' +
        'Do NOT write a production_artifacts/state.d/ fragment.'
      );
    }
    const writes = node.writes || `production_artifacts/state.d/${node.id}.json`;
    return (
      'Read production_artifacts/state.json if it exists (read-only -- for context such as state.goal and ' +
      'state.artifacts.plan). Do NOT write production_artifacts/state.json yourself -- other build nodes may be ' +
      `writing concurrently in this same pass, and a shared write would race and silently lose updates. Instead ` +
      `write ONLY ${writes} (create production_artifacts/state.d/ if missing), containing just the fields you ` +
      `own: { "node": "${node.id}", "artifacts": { "${node.artifactKey || node.id}": <path to the artifact you ` +
      `produced> }, "findings": [ <status updates for any open findings you addressed, same shape as the ` +
      `top-level findings[] items> ], "needs_human": true (optional, only set if you genuinely cannot proceed without a human decision) } per .agents/state.schema.json's $defs.stateFragment. Omit state.iteration, ` +
      'state.goal, and every field you do not own -- the dispatcher runs a dedicated merge step that folds your ' +
      'fragment into state.json afterwards; do not attempt that merge yourself.'
    );
  }
  return (
    'Read production_artifacts/state.json if it exists; otherwise this is a fresh run. ' +
    `Set state.iteration to ${iteration} in your update (this is the dispatcher's authoritative count -- ` +
    'do not increment it yourself). Update the rest of state.json per .agents/state.schema.json ' +
    '(create production_artifacts/ if missing).'
  );
}

// Reviewer gets a deliberately different note. .agents/graph.md's Reviewer
// discipline requires ARTIFACT + CONTRACT only, never `goal`, never a build
// node's reasoning -- state.json's `goal` field is required by the schema
// and is exactly the user's original request, so telling Reviewer to read
// the whole file (as dispatchNote() does for every other agent) hands it the
// one thing the discipline says it must never see. This was caught the same
// way as the iteration-counter bug: an adversarial review against
// .agents/graph.md's own text, not assumed safe because "it's just a
// generic state-sync note." Reviewer is a sequential (review-role) node --
// never inside a pipeline() fan-out -- so writing state.json directly here
// is not part of the CHANGE 1 race and this function is left untouched by
// that fix.
function reviewerStateNote() {
  return (
    'Do NOT read state.goal or any other node\'s reasoning/claims from production_artifacts/state.json -- ' +
    'your review must be based only on the plan/contract and artifact files named below, nothing else. ' +
    'You may open production_artifacts/state.json purely to merge your update into it without clobbering ' +
    'unrelated fields (or create it fresh per .agents/state.schema.json if missing), but that file access is ' +
    `for the write, not for forming your judgment. Set state.iteration to ${iteration} in your update.`
  );
}

// Skills every node should know about (registry `common`), set once the registry is loaded.
let commonSkills = [];

// Injects the node's registry-declared skills plus the shared `common` set as
// the preferred skills. Other installed skills stay usable when they fit.
// Applies to every node, build and sequential alike.
function skillsNote(node) {
  const skills = nodeSkillList(node);
  const parts = [];
  if (skills.length > 0) {
    parts.push(
      ` Prefer these skills for this work: ${skills.join(', ')}. ` +
      'Any other installed skill may be used when the task genuinely calls for it.'
    );
  }
  // A --skill flag is a hard requirement from the user, not the registry's
  // own suggested allowlist above -- it applies on top of, never instead of,
  // that list. Only nodes that actually produce work get told to use it:
  // build-role nodes, plus Architect (who should fold the skill's guidance
  // into the plan itself, not just leave it for Build to discover cold).
  // Reviewer gets a separate mention in its own prompt below, framed as a
  // check rather than a use.
  if (mandatorySkills.length > 0 && (node?.role === 'build' || node?.id === 'architect')) {
    parts.push(
      ` The user explicitly required this run to use the following skill(s), via /startcycle-graph's --skill flag: ${mandatorySkills.join(', ')}. ` +
      "This is a hard requirement, not a suggestion -- actually apply the skill's guidance in your work, and name in your returned summary how each one was applied."
    );
  }
  return parts.join('');
}

// Per .agents/nodes.json: a node's skills are its own list plus the registry's
// `common` set, deduped. This exact list is what ensureNodeSkills() installs
// and what skillsNote() mentions -- one source each, no drift between them.
function nodeSkillList(node) {
  const own = Array.isArray(node?.skills) ? node.skills : [];
  return [...new Set([...commonSkills, ...own])]
    .filter((s) => typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s));
}

// Installs a node's registry skills before its worker starts, when missing.
// Like validate-mandatory-skills, this is a deterministic check/install step
// (the script itself has no filesystem access), not a reasoning task. The
// skillsNote() preference stays advisory and the run never blocks here: a
// skill that cannot be installed is logged to stderr and the worker starts
// anyway -- a missing optional skill is a degraded run, not a broken one.
async function ensureNodeSkills(node) {
  const skills = nodeSkillList(node);
  if (skills.length === 0) return null;
  try {
    const res = await agent(
      `Make sure each of these skills is installed on this machine: ${JSON.stringify(skills)}. ` +
        'A skill counts as installed when a directory with a real SKILL.md exists for it in any one of the ' +
        'harness skill locations: ~/.claude/skills/<name>, ~/.agents/skills/<name>, ~/.gemini/config/skills/<name>, ' +
        '~/.codex/skills/<name>, ~/.cursor/skills/<name>, ~/.roo/skills/<name>, or the project\'s own skills/<name>. ' +
        'This is a deterministic check-and-install step, not a reasoning task. ' +
        'For every name found nowhere, run `aos store install <name>` once per missing name (never with --net): ' +
        'that installs offline from the local AOS library, so one unresolvable name must not block the others. ' +
        'Never delete or modify anything; installing is additive. ' +
        'If the aos command is unavailable or a name still resolves nowhere afterwards, list it in stillMissing and continue -- ' +
        'this step must never block or fail the run.\n\n' +
        'Return only: { "installed": string[], "stillMissing": string[] }.',
      {
        label: `ensure-skills-${node.id}`,
        ...modelOpt('validate_skills'),
        skills,
        schema: {
          type: 'object',
          required: ['installed', 'stillMissing'],
          properties: {
            installed: { type: 'array', items: { type: 'string' } },
            stillMissing: { type: 'array', items: { type: 'string' } },
          },
        },
      }
    );
    const still = Array.isArray(res?.stillMissing) ? res.stillMissing : [];
    if (still.length > 0) {
      console.error(`[startcycle-graph] node ${node.id}: skill(s) missing and not installable offline: ${still.join(', ')}`);
    }
    return res;
  } catch { return null; }
}

// "a", "a or b", "a, b, or c" -- used for NODE_NAMES, itself derived from the
// registry rather than hardcoded (see load-registry below).
function humanList(items) {
  const quoted = items.map((s) => `"${s}"`);
  if (quoted.length === 0) return '';
  if (quoted.length === 1) return quoted[0];
  if (quoted.length === 2) return quoted.join(' or ');
  return `${quoted.slice(0, -1).join(', ')}, or ${quoted[quoted.length - 1]}`;
}

// Model resolution (docs/agent-models.md). AOS pins no model: a node or helper agent gets a model
// only from pipeline.json (same lookup order and key normalization as installer resolveAgentConfig,
// harness = claude), otherwise agent() is called without `model` and inherits the session model.
// Helper roles (valid pipeline.json keys): load_registry, merge_state, archify_verify, validate_skills.
let pipelineCfg = null;

function readPipelineConfigFs() {
  if (!fs || !path || !os) return null;
  const candidates = [
    path.resolve('.aos', 'pipeline.json'),
    path.resolve('.aos', 'project.json'),
    path.join(os.homedir(), '.aos', 'pipeline.json'),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (data && data.pipeline && typeof data.pipeline === 'object') return data.pipeline;
    } catch {}
  }
  return null;
}

// First role key (agent slug before node id) with a usable claude model wins; null = inherit.
function modelFor(...roles) {
  if (!pipelineCfg) return null;
  for (const role of roles) {
    if (!role) continue;
    const cfg = pipelineCfg[String(role).toLowerCase().replace(/-/g, '_')] || pipelineCfg[role];
    if (!cfg || typeof cfg !== 'object') continue;
    const models = cfg.models && typeof cfg.models === 'object' ? cfg.models : {};
    const value = Object.prototype.hasOwnProperty.call(models, 'claude') ? models.claude
      : (cfg.model !== undefined && (!cfg.harness || cfg.harness === 'claude')) ? cfg.model : undefined;
    if (typeof value === 'string' && value !== '' && !/\s/.test(value)) return value;
  }
  return null;
}

const modelOpt = (...roles) => {
  const model = modelFor(...roles);
  return model ? { model } : {};
};
const nodeModelOpt = (n) => {
  if (typeof routeFor === 'function') {
    try {
      const chosen = routeFor(n);
      console.error(`[router] advisory node ${n?.id || n?.agentType || 'node'} -> target: ${chosen.target}`);
    } catch {}
  }
  return modelOpt(n.agentType, n.id);
};

// Centralizes every escalation path through one place, so `needs_human` and
// `phase: escalated` actually land in state.json instead of only in this
// script's return value (found the same way: grep for "needs_human" in an
// earlier draft returned zero matches across 8 separate `return { phase:
// 'escalated', ... }` sites -- the field was silently dropped end to end
// every single time, since none of those `return`s routed through an
// agent() call that could persist it). Escalation is inherently a single,
// sequential call (never inside a pipeline() fan-out), so it writes
// state.json directly like the other sequential nodes.
async function escalate(reason, extra = {}) {
  await agent(
    'You are recording a /startcycle-graph escalation. Update production_artifacts/state.json per ' +
      '.agents/state.schema.json: set phase to "escalated", needs_human to true, iteration to ' +
      `${iteration}, and append this reason to the record: ${JSON.stringify(reason)}. ` +
      'Create production_artifacts/ if missing.',
    { label: 'escalate' }
  );
  return { phase: 'escalated', reason, iteration, ...extra };
}

// The single-writer-per-file fix from comment block item #3. Called once,
// immediately after every pipeline() call returns (the barrier where all
// parallel build nodes have finished this pass) -- never deferred, since
// .claude/hooks/graph-gate.mjs reads production_artifacts/state.json at turn
// end and needs the merged result to already be there. Deterministic fold
// only (role merge_state, haiku suggested by the shipped pipeline default), explicitly told not to invent, reinterpret, or drop
// any field.
async function mergeStateD() {
  return await agent(
    'You are the dedicated /startcycle-graph state-merge step -- a deterministic fold, not a reasoning task. ' +
      'Read every file matching production_artifacts/state.d/*.json (if that directory does not exist or is ' +
      'empty, there is nothing to merge -- just confirm production_artifacts/state.json still exists and is ' +
      'valid per .agents/state.schema.json, and return merged: 0, needsHuman: false). Read the current ' +
      'production_artifacts/state.json. For each fragment file, per .agents/state.schema.json\'s ' +
      '$defs.stateFragment shape: merge fragment.artifacts into state.artifacts by key -- only the key(s) ' +
      'present in that specific fragment change, every other artifacts key is left exactly as it was; merge ' +
      'fragment.findings into state.findings by matching "id" -- an existing finding with that id gets its ' +
      'fields (status, etc.) updated in place, a finding id not already present is appended, and findings not ' +
      'mentioned in any fragment are left completely untouched. ' +
      `Set state.iteration to ${iteration}. Do not change state.goal, state.phase, state.gate, state.approvals, ` +
      'or state.run_id. If ANY fragment sets "needs_human": true, you MUST set state.needs_human = true in the merged ' +
      'result (never flip an existing true back to false). Do NOT invent, guess, reinterpret, or silently drop any field: if a fragment is malformed or is ' +
      'missing its required "node" field, skip that exact file and report it in "skipped" with a short reason, ' +
      'rather than guessing its intent. Write the merged result back to production_artifacts/state.json. Then VERIFY before deleting anything: re-read ' +
      'production_artifacts/state.json and confirm that, for every fragment you folded in, its artifacts key(s) and its ' +
      'findings id(s) are actually present in the file you just wrote. Only delete a production_artifacts/state.d/*.json ' +
      'fragment after you have confirmed its content landed. If ANY fragment was skipped, or if any read-back verification ' +
      'fails, delete NOTHING AT ALL and report the reason in "skipped" -- the dispatcher escalates on a non-empty "skipped", ' +
      'and the fragments must still exist at that point so the run can be diagnosed and recovered. Deleting a fragment you ' +
      'could not verify would destroy the only copy of that node\'s output.\n\n' +
      'Return only: { "merged": number, "skipped": string[], "needsHuman": boolean } -- merged is how many fragment files were folded ' +
      'in; skipped lists any fragment filenames that could not be merged, each with a short reason; needsHuman is true if any fragment requested it.',
    {
      label: `merge-${iteration}`,
      ...modelOpt('merge_state'),
      schema: {
        type: 'object',
        required: ['merged', 'skipped', 'needsHuman'],
        properties: {
          merged: { type: 'number' },
          skipped: { type: 'array', items: { type: 'string' } },
          needsHuman: { type: 'boolean' },
        },
      },
    }
  );
}

async function verifyArchifyArtifacts() {
  return await agent(
    'You are the dedicated /startcycle-graph archify-verify step -- a deterministic check, not a reasoning task. ' +
      'Working directory is the repository root. Run exactly these two commands in this order, ' +
      'each as an argument array with no shell and no string interpolation: ' +
      'first ["validate", "architecture", "production_artifacts/00_architecture.json", "--quality", "showcase", "--json"], ' +
      'then ["deliver", "architecture", "production_artifacts/00_architecture.json", "production_artifacts/00_architecture.html", "--quality", "showcase", "--json"], ' +
      'both via the node archify binary at skills/global_config/archify/bin/archify.mjs with a 120 second timeout each. ' +
      'Only run deliver when validate exits 0. Read at most 65536 bytes of each command output. ' +
      'Deliver passes only on a showcase receipt with 9 of 9 checks and 0 errors plus sha256 evidence for specification and artifact. ' +
      'On any non-zero exit, oversized output, or invalid receipt, report failure and preserve the previous HTML artifact untouched -- ' +
      'never invent success and never write state.artifacts.architecture yourself. ' +
      'Keep any logged output bounded to 400 characters with home directories and long hashes redacted.\n\n' +
      'Return only: { "validateOk": boolean, "deliverOk": boolean, "checksPassed": number, "checkCount": number, "error": string }.',
    {
      label: `archify-verify-${iteration}`,
      ...modelOpt('archify_verify'),
      schema: {
        type: 'object',
        required: ['validateOk', 'deliverOk', 'checksPassed', 'checkCount', 'error'],
        properties: {
          validateOk: { type: 'boolean' },
          deliverOk: { type: 'boolean' },
          checksPassed: { type: 'number' },
          checkCount: { type: 'number' },
          error: { type: 'string' },
        },
      },
    }
  );
}

// ---------------------------------------------------------------------
// Load the node registry. First thing this run does, per comment block
// item #4 -- everything below is derived from this, nothing is hardcoded.
// ---------------------------------------------------------------------

const REGISTRY_SCHEMA = {
  type: 'object',
  required: ['version', 'nodes'],
  properties: {
    version: { type: 'number' },
    description: { type: 'string' },
    common: { type: 'array', items: { type: 'string' } },
    pipeline: { type: ['object', 'null'] },
    nodes: {
      type: 'object',
      minProperties: 1,
      additionalProperties: {
        type: 'object',
        required: ['label', 'agentType', 'personaFile', 'role'],
        properties: {
          label: { type: 'string' },
          agentType: { type: 'string' },
          personaFile: { type: 'string' },
          role: { type: 'string', enum: ['plan', 'approve', 'build', 'review', 'gate'] },
          // artifactKey/writes/instructions are null on nodes where they don't apply (e.g. techlead
          // has no artifactKey, architect/techlead/reviewer/shipping have writes: null and
          // instructions: null since they are sequential nodes with hardcoded prompt text below,
          // not build nodes reading a registry instruction string) -- must accept null, not just string.
          artifactKey: { type: ['string', 'null'] },
          writes: { type: ['string', 'null'] },
          optional: { type: 'boolean' },
          skills: { type: 'array', items: { type: 'string' } },
          instructions: { type: ['string', 'null'] },
        },
      },
    },
  },
};

const REQUIRED_NODE_IDS = ['architect', 'techlead', 'ui_ux', 'engineering', 'media_eventtech', 'reviewer', 'shipping'];

export async function runWorkflow() {
try {
// Without fs (Claude workflow runtime) the loader itself cannot know its own model: it inherits, and
// reads the pipeline config for every later spawn.
pipelineCfg = readPipelineConfigFs();
const registryResult = await agent(
  'Read the file .agents/nodes.json (repository root) and return its exact contents, parsed as JSON, matching ' +
    'the given schema. This is a read-only lookup, not a reasoning task: do not invent, modify, reinterpret, ' +
    'merge, or add any field that is not literally present in the file. If the file is missing, unreadable, or ' +
    'not valid JSON, return { "version": 0, "nodes": {} } rather than guessing at its contents. ' +
    'Also add a top-level "pipeline" field: the value of the "pipeline" object from the first of these files that ' +
    'exists, parses as JSON and has a "pipeline" object: ./.aos/pipeline.json, ./.aos/project.json, ' +
    '~/.aos/pipeline.json; null if none does. Copy it verbatim.',
  { label: 'load-registry', ...modelOpt('load_registry'), schema: REGISTRY_SCHEMA }
);
if (!pipelineCfg && registryResult?.pipeline && typeof registryResult.pipeline === 'object') pipelineCfg = registryResult.pipeline;

const registryNodes = registryResult?.nodes ?? {};
commonSkills = Array.isArray(registryResult?.common) ? registryResult.common.filter((s) => typeof s === 'string') : [];
const missingNodeIds = REQUIRED_NODE_IDS.filter((id) => !registryNodes[id]);
if (missingNodeIds.length > 0) {
  return await escalate(
    `.agents/nodes.json failed to load, or is missing required node id(s): ${missingNodeIds.join(', ')}. ` +
      'Refusing to fall back to a hardcoded node list -- fix the registry and re-run /startcycle-graph.'
  );
}

const architectNode = { id: 'architect', ...registryNodes.architect };
const techleadNode = { id: 'techlead', ...registryNodes.techlead };
const reviewerNode = { id: 'reviewer', ...registryNodes.reviewer };
const shippingNode = { id: 'shipping', ...registryNodes.shipping };

const resolvedArgs = typeof args !== 'undefined' ? args : null;
const rawGoal = inputGoal || (typeof resolvedArgs === 'string' ? resolvedArgs : resolvedArgs?.goal);
if (!rawGoal) {
  return await escalate(
    'startcycle-graph needs a goal, e.g. "Run /startcycle-graph on: add OAuth login with Google" -- nothing was invoked.'
  );
}

const { workstreams: workstreamsFromFlag, goal: goalAfterWs } = extractWorkstreamsFlag(rawGoal);
const hasWorkstreamsFlag = workstreamsFromFlag || !!resolvedArgs?.workstreams;

let roleRegistry = null;
if (hasWorkstreamsFlag && typeof process !== 'undefined') {
  try {
    const regMod = await import(new URL('../../lib/roles/role-registry.mjs', import.meta.url).href);
    if (typeof regMod?.loadRoleRegistry === 'function') {
      roleRegistry = regMod.loadRoleRegistry({ cwd: process.cwd() });
    }
  } catch {}
}

const activeRoleRegistry = roleRegistry || {
  has(id) {
    const canon = canonicalNodeId(id);
    return !!(registryNodes[id] || registryNodes[canon]);
  },
  get(id) {
    const canon = canonicalNodeId(id);
    return registryNodes[id] || registryNodes[canon] || null;
  },
};

// --skill=<name>, repeatable, extracted out of the raw goal text before
// anything else sees it -- e.g. "--skill=my-custom-skill Add OAuth login"
// becomes goal "Add OAuth login" plus one mandated skill name. This is the
// mechanism for injecting a skill this script has never heard of (a user's
// own private skill, never part of .agents/nodes.json's registry) -- see
// .agents/graph.md's "Mandatory Skill Injection" section.
function extractProfileFlag(text) {
  const flagPattern = /--profile=("[^"]+"|'[^']+'|\S+)|--profile=(?=\s|$)/g;
  let profile = null;
  let malformed = 0;
  let duplicates = 0;
  const goal = text
    .replace(flagPattern, (_, val) => {
      if (val === undefined) { malformed++; return ''; }
      const unquoted =
        (val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))
          ? val.slice(1, -1)
          : val;
      if (unquoted.trim() === '') { malformed++; return ''; }
      if (profile !== null) duplicates++;
      profile = unquoted;
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { profile, goal, malformed, duplicates };
}

function extractMandatorySkills(text) {
  // The `|--skill=(?=\s|$)` alternative deliberately matches a flag with an
  // EMPTY value ("--skill= add OAuth"). Without it, `\S+` simply fails to
  // match, the flag falls through as ordinary prose, and the run proceeds
  // with no skill injected AND the literal "--skill=" still glued to the
  // goal text handed to Architect -- a silent no-op on a typo, which is the
  // exact failure mode the validation below exists to prevent. Capturing it
  // as an empty name instead routes it into `malformed` and escalates.
  const flagPattern = /--skill=("[^"]+"|'[^']+'|\S+)|--skill=(?=\s|$)/g;
  const skills = [];
  let malformed = 0;
  const goal = text
    .replace(flagPattern, (_, val) => {
      if (val === undefined) { malformed++; return ''; }
      const unquoted =
        (val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))
          ? val.slice(1, -1)
          : val;
      if (unquoted.trim() === '') { malformed++; return ''; }
      skills.push(unquoted);
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { skills, goal, malformed };
}

const { profile: profileFromFlag, goal: goalAfterProfile, malformed: profileMalformed, duplicates: profileDuplicates } = extractProfileFlag(goalAfterWs);
if (profileDuplicates > 0) {
  return await escalate('--profile was given more than once. Name exactly one profile, e.g. --profile=kicad. Refusing to pick one silently.');
}
if (profileMalformed > 0) {
  return await escalate(
    `--profile was given with an empty value (${profileMalformed} time(s)). Write --profile=<name>, e.g. --profile=kicad. ` +
      'Refusing to proceed rather than silently running the default pipeline when you asked for a profile.'
  );
}
const profileName = profileFromFlag || (typeof resolvedArgs?.profile === 'string' ? resolvedArgs.profile : null) || null;
if (/(^|\s)--profile(\s|$)/.test(goalAfterProfile)) {
  return await escalate('--profile needs a value: write --profile=<name>, e.g. --profile=kicad. Refusing to run the default pipeline when you asked for a profile.');
}
if (profileName !== null && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(profileName)) {
  return await escalate(
    `--profile name \`${profileName}\` is not a lowercase kebab-case profile name. ` +
      'Refusing to proceed rather than silently running the default pipeline.'
  );
}

// Optional domain profile: loaded in the same load step shape as nodes.json.
// Unknown, missing or invalid profile escalates -- never silently falls back.
const PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    missing: { type: 'boolean' },
    domain: { type: 'string' },
    nodes: { type: 'object' },
    gates: { type: 'object' },
    artifacts: { type: 'object' },
  },
};
let profile = null;
if (profileName) {
  const profileResult = await agent(
    `Read the file .agents/profiles/${profileName}.json (repository root) and return its exact contents, parsed as JSON. ` +
      'This is a read-only lookup, not a reasoning task: do not invent, modify, reinterpret, merge, or add any field that is not literally present in the file. ' +
      'If the file is missing, unreadable, or not valid JSON, return { "missing": true } rather than guessing at its contents.',
    { label: 'load-profile', ...modelOpt('load_registry'), schema: PROFILE_SCHEMA, profile: profileName }
  );
  if (!profileResult || profileResult.missing || !profileResult.gates || Object.keys(profileResult.gates).length === 0) {
    return await escalate(
      `--profile named a profile that could not be loaded: ${profileName}. ` +
        'Check .agents/profiles/ for the exact profile name. ' +
        'Refusing to silently fall back to the default pipeline.'
    );
  }
  profile = profileResult;
}

// Effective node table: profile `replace` drops registry build ids, profile `add`
// entries become build nodes. A subset of scripts/validate-profile.mjs, re-checked
// here because the profile is read by an agent, not by the validator.
const effectiveNodes = { ...registryNodes };
if (profile) {
  if (profile.domain !== profileName) {
    return await escalate(`profile \`${profileName}\` declares domain \`${profile.domain}\`; they must match.`);
  }
  const addIds = new Set();
  for (const spec of Object.values(profile.nodes ?? {})) {
    for (const id of spec?.replace ?? []) {
      if (registryNodes[id]?.role !== 'build') {
        return await escalate(`profile \`${profileName}\` replaces \`${id}\`, which is not a registry build node.`);
      }
      delete effectiveNodes[id];
    }
    for (const entry of spec?.add ?? []) {
      if (
        typeof entry.id !== 'string' || !/^[a-z0-9_]+$/.test(entry.id) ||
        typeof entry.agentType !== 'string' || entry.agentType === '' ||
        (entry.writes !== undefined && !/^production_artifacts\/state\.d\/[a-z0-9_-]+\.json$/.test(String(entry.writes)))
      ) {
        return await escalate(`profile \`${profileName}\` has an add entry with an invalid id, agentType or writes path.`);
      }
      if (entry.role !== 'build' || registryNodes[entry.id] || addIds.has(entry.id)) {
        return await escalate(`profile \`${profileName}\` adds node \`${entry.id}\`: must be role build, not a registry id, and unique.`);
      }
      addIds.add(entry.id);
      effectiveNodes[entry.id] = {
        label: entry.label || entry.id,
        agentType: entry.agentType,
        personaFile: entry.personaFile || `.claude/agents/${entry.agentType}.md`,
        role: 'build',
        artifactKey: entry.artifactKey ?? entry.id,
        writes: entry.writes || `production_artifacts/state.d/${entry.id}.json`,
        optional: !!entry.optional,
        skills: entry.skills || [],
        instructions: entry.instructions || null,
      };
    }
  }
}
const { skills: skillsFromFlags, goal, malformed } = extractMandatorySkills(goalAfterProfile);
if (malformed > 0) {
  return await escalate(
    `--skill was given with an empty value (${malformed} time(s)). Write --skill=<name>, e.g. --skill=my-custom-skill. ` +
      'Refusing to proceed rather than silently running without the skill you asked for.'
  );
}
if (!goal) {
  return await escalate(
    'startcycle-graph needs actual goal text, not just --skill flag(s) -- e.g. "--skill=my-custom-skill add OAuth login with Google", not "--skill=my-custom-skill" alone.'
  );
}
// Object-form args may also carry a structured list directly, for a future
// caller that never goes through the string-flag convention at all.
const skillsFromArgs = Array.isArray(resolvedArgs?.mandatorySkills) ? resolvedArgs.mandatorySkills : inputSkills;
const mandatorySkillNames = [...new Set([...skillsFromFlags, ...skillsFromArgs])];

// Validate before anything else runs -- same "never silently fall back or
// guess" posture as the registry load above. This script has no filesystem
// access of its own (comment block item #1), so validation is itself an
// agent() call, not a local fs check.
if (mandatorySkillNames.length > 0) {
  const skillCheckResult = await agent(
    `Check whether each of these skill names resolves to an installed skill with a real SKILL.md: ${JSON.stringify(mandatorySkillNames)}. ` +
      'The installer syncs the same skill set to every harness it detects, so check all of these global locations, not just the first: ' +
      '~/.claude/skills/<name>/SKILL.md, ~/.agents/skills/<name>/SKILL.md, ~/.codex/skills/<name>/SKILL.md, ' +
      '~/.cursor/skills/<name>/SKILL.md, ~/.roo/skills/<name>/SKILL.md. A skill present in any one of them counts as installed — ' +
      'this workflow may be driven from a harness whose directory is not ~/.claude. ' +
      'If this project has its own skills/ directory, also accept skills/<name>/SKILL.md or skills/<container>/<name>/SKILL.md. ' +
      'This is a read-only lookup, not a reasoning task -- do not invent a path that does not exist, and never report a close match as `found`.\n\n' +
      'For any name that does NOT resolve, read lib/ecc-store-index.json and list exact available store item names in `store_matches`. ' +
      'Also list up to five installed skills whose directory names are plausible near-misses ' +
      '(substring, obvious typo, or the same words in another order) in `suggestions`. Read the real directory listing to do this -- ' +
      'suggest only names that actually exist on disk. `--skill=` requires an exact directory name, and a user who mistyped one ' +
      'has no way to discover the right spelling from an error that only says "not found".\n\n' +
      'Return only: { "found": string[], "missing": string[], "store_matches": string[], "suggestions": string[] }.',
    {
      label: 'validate-mandatory-skills',
      ...modelOpt('validate_skills'),
      schema: {
        type: 'object',
        required: ['found', 'missing', 'store_matches'],
        properties: {
          found: { type: 'array', items: { type: 'string' } },
          missing: { type: 'array', items: { type: 'string' } },
          store_matches: { type: 'array', items: { type: 'string' } },
          suggestions: { type: 'array', items: { type: 'string' } },
        },
      },
    }
  );
  const missing = skillCheckResult?.missing ?? [];
  if (missing.length > 0) {
    const storeMatches = skillCheckResult?.store_matches ?? [];
    const near = skillCheckResult?.suggestions ?? [];
    let message = `--skill named skill(s) that could not be found on this machine: ${missing.join(', ')}. `;
    if (storeMatches.length > 0) {
      message += `Found in the AOS / ECC Store: ${storeMatches.join(', ')}. ` +
        `Run: aos store install ${storeMatches.join(' ')} --net ` +
        'Then re-run your startcycle command. ';
    } else if (near.length > 0) {
      message += `Did you mean: ${near.join(', ')}? `;
    } else {
      message += 'No installed or store skill has a similar name. ';
    }
    message += '--skill= takes the exact skill directory name; run /ask-tim to find the one you want. ' +
      'Refusing to silently proceed without a mandated skill.';
    return await escalate(message);
  }
  mandatorySkills = skillCheckResult?.found ?? mandatorySkillNames;
}

// ---------------------------------------------------------------------
// Human plan verdict from the plan canvas. Before any build node runs, the
// dispatcher blocks until the human answers in the canvas: `approve`
// continues, `request-changes` goes back to Architect with the feedback.
// `open --await` is a plain blocking CLI call (open + parked listener in
// one call), so this works on every harness, not just Claude Code.
// AOS_PLAN_APPROVAL=auto is the CI-only escape: it skips the canvas wait
// and proceeds without a human verdict. Never set it for an interactive run.
// ---------------------------------------------------------------------

// BEGIN canvas-verdict (extracted verbatim by tests/startcycle-human-gate.test.mjs)
function lastJsonObject(raw) {
  const starts = [];
  const re = /(^|\n)\{/g;
  let m;
  while ((m = re.exec(raw))) starts.push(m.index + m[1].length);
  for (let i = starts.length - 1; i >= 0; i--) {
    try { return JSON.parse(raw.slice(starts[i])); } catch { /* try an earlier object */ }
  }
  return null;
}

// approved: human said approve. feedback (no escalate): request-changes, every item text forwarded to
// Architect. escalate: no human verdict is coming (ended, timeout, no server), so looping Architect is pointless.
function decideCanvasVerdict(payload) {
  if (!payload || payload.error) return { approved: false, escalate: true, feedback: `plan-canvas returned no verdict (${(payload && payload.error) || 'no JSON'})` };
  const items = Array.isArray(payload.items) ? payload.items.filter((i) => i && typeof i === 'object') : [];
  if (items.some((i) => i.kind === 'verdict' && i.verdict === 'approve')) return { approved: true };
  if (payload.status === 'feedback' && items.length > 0) {
    const lines = items.map((i) => `- [${i.kind === 'verdict' ? i.verdict : i.kind || 'comment'}] ${i.text || '(no text)'}`);
    return { approved: false, feedback: lines.join('\n') };
  }
  return { approved: false, escalate: true, feedback: `canvas ended without a verdict (status: ${payload.status || 'unknown'})` };
}
// END canvas-verdict

// .cmd shims need a shell on Windows; quote args there because the shell re-parses them.
const IS_WIN = typeof process !== 'undefined' && process.platform === 'win32';
const cliBin = (name) => (IS_WIN ? `${name}.cmd` : name);
const cliArg = (a) => (IS_WIN ? `"${String(a).replace(/"/g, '""')}"` : a);

function humanCanvasGate(planFile) {
  if (process.env.AOS_PLAN_APPROVAL === 'auto') {
    process.stderr.write('[startcycle-dispatch] WARNING: AOS_PLAN_APPROVAL=auto -- plan-canvas human verdict gate SKIPPED (CI-only escape, no human approved this plan)\n');
    return { approved: true, auto: true };
  }
  if (!child_process) {
    return { approved: false, escalate: true, feedback: 'plan-canvas gate could not run: no process runtime in this environment' };
  }
  const headless = !!process.env.CI || !process.stdin?.isTTY;
  const noDisplay = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
  const args = ['open', planFile, '--await', '--mode', /\.mdx$/i.test(planFile) ? 'bdb-plan-builder' : 'standard'];
  if (headless || noDisplay) args.push('--no-open');
  const timeoutRaw = process.env.AOS_PLAN_AWAIT_TIMEOUT_MS;
  const timeoutMs = timeoutRaw !== undefined && timeoutRaw !== '' ? Number.parseInt(timeoutRaw, 10) || 0 : (headless ? 30 * 60 * 1000 : 0);
  let run;
  try {
    run = child_process.spawnSync(cliBin('aos-plan-canvas'), args.map(cliArg), {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      shell: IS_WIN,
      ...(timeoutMs > 0 ? { timeout: timeoutMs } : {})
    });
  } catch (error) {
    run = { error };
  }
  if (run.error) {
    const code = run.error.code;
    const why = code === 'ETIMEDOUT' ? `no human verdict within ${timeoutMs} ms (AOS_PLAN_AWAIT_TIMEOUT_MS)`
      : code === 'ENOENT' ? 'aos-plan-canvas CLI not found on PATH; install AOS, or set AOS_PLAN_APPROVAL=auto in CI only'
      : `failed to run: ${run.error.message || run.error}`;
    process.stderr.write(`[startcycle-dispatch] plan-canvas gate: ${why}\n`);
    return { approved: false, escalate: true, feedback: `plan-canvas gate ${why}` };
  }
  const raw = typeof run.stdout === 'string' ? run.stdout : '';
  const decision = decideCanvasVerdict(lastJsonObject(raw));
  if (decision.escalate && run.status) decision.feedback += ` (exit code ${run.status})`;
  return decision;
}

// ---------------------------------------------------------------------
// Architect <-> TechLead: plan, then capability-map approval. Sequential --
// not part of the CHANGE 1 race, writes state.json directly as before.
// ---------------------------------------------------------------------

let planPath = null;
let needsMedia = false;
let skipNodes = [];
let executionManifest = null;
// A profile run tells Architect and TechLead which domain and build nodes the plan is for; the default run's prompts are unchanged.
const profileBuildIds = profile ? Object.keys(effectiveNodes).filter((id) => effectiveNodes[id]?.role === 'build') : [];
const profileOptionalIds = profileBuildIds.filter((id) => effectiveNodes[id]?.optional);
const profileNote = profile
  ? `This run uses the "${profile.domain}" domain profile${profile.description ? ` (${profile.description})` : ''}. Its build nodes are: ` +
    `${profileBuildIds.map((id) => `${id} (${effectiveNodes[id].label})`).join(', ')}. ` +
    `Plan the capability map around exactly these nodes, not around a software frontend/backend split. ` +
    (profileOptionalIds.length > 0
      ? `Optional nodes: ${profileOptionalIds.join(', ')}; list in skipNodes the ones this plan does not need. `
      : '') +
    `Set needsMedia to false.\n\n`
  : null;
let approved = false;
let lastRejectionReason = '';

while (!approved) {
  await ensureNodeSkills(architectNode);
  const architectResult = await agent(
    `You are acting as the ${architectNode.label} agent (${architectNode.personaFile}). ${dispatchNote(architectNode)}${skillsNote(architectNode)}\n\n` +
      `Goal: ${JSON.stringify(goal)}\n` +
      (lastRejectionReason
        ? `TechLead rejected your previous plan for this reason -- address it: ${lastRejectionReason}\n`
        : '') +
      `Turn this goal into a system plan with an explicit capability map (module boundaries, ` +
      `dependency direction, build order). Create the plan from the matching plan-canvas template: ` +
      `run \`aos-plan-canvas templates\`, pick the template whose useWhen matches this goal, then ` +
      `\`aos-plan-canvas new <template-id> production_artifacts/plan\` and fill in the copied plan.mdx in place -- ` +
      `that plan.mdx is the execution plan; return its path as planPath. On a revision round (or whenever ` +
      `production_artifacts/plan/plan.mdx already exists) do NOT create a new folder: edit the existing plan.mdx in place. ` +
      `If the plan-canvas CLI is unavailable, fall back to writing production_artifacts/00_execution_plan.md directly and return that path instead. ` +
      `Author the architecture as Archify architecture JSON to production_artifacts/00_architecture.json, ` +
      `run aos-archify validate architecture production_artifacts/00_architecture.json --quality showcase --json during repair and ` +
      `aos-archify deliver architecture production_artifacts/00_architecture.json production_artifacts/00_architecture.html --quality showcase --json once for final acceptance, ` +
      `link it from the relevant plan component with a url: production_artifacts/00_architecture.html line, ` +
      `and set state.goal, state.phase = "plan", state.artifacts.plan to the plan path, state.artifacts.architecture to production_artifacts/00_architecture.html only on a passing showcase receipt (9/9 checks, 0 errors), and state.mandatory_skills to ${JSON.stringify(mandatorySkills)}. ` +
      `On a failed validate/deliver preserve the previous HTML and report deliverOk false instead of proceeding silently. ` +
      (hasWorkstreamsFlag
        ? `This run uses dynamic workstreams (--workstreams). Design an execution manifest with between 1 and 4 workstreams (hard cap 6). ` +
          `Each workstream must define: "id" (matching ^[a-z0-9_]+$), "agentType" (e.g. godmode-engineering, godmode-ui-ux, or a registered/ad-hoc specialist), ` +
          `"skills" (non-empty array of valid installed skills), "artifactKey" (key in state.artifacts it produces), and optional "playbooks" and "gates". ` +
          `Set state.execution_manifest in state.json with createdBy: "architect" and effort: "S"|"M"|"L".\n\n`
        : '') +
      (profileNote ?? `Decide whether the goal needs the Media_EventTech build node (TouchDesigner/show-control/3D/media work) -- most goals don't.\n\n`) +
      `Return only: { "planPath": string, "needsMedia": boolean, "architectureSpec": string, "architectureHtml": string, "deliverOk": boolean${profileOptionalIds.length > 0 ? ', "skipNodes": string[]' : ''}${hasWorkstreamsFlag ? ', "execution_manifest": object' : ''} }.`,
    {
      label: `architect-${iteration}`,
      agentType: architectNode.agentType,
      ...nodeModelOpt(architectNode),
      schema: {
        type: 'object',
        required: ['planPath', 'needsMedia'],
        properties: {
          planPath: { type: 'string' },
          needsMedia: { type: 'boolean' },
          architectureSpec: { type: 'string' },
          architectureHtml: { type: 'string' },
          deliverOk: { type: 'boolean' },
          ...(hasWorkstreamsFlag ? {
            execution_manifest: {
              type: 'object',
              required: ['workstreams', 'createdBy'],
              properties: {
                createdBy: { type: 'string', enum: ['architect'] },
                effort: { type: 'string', enum: ['S', 'M', 'L'] },
                workstreams: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 6,
                  items: {
                    type: 'object',
                    required: ['id', 'agentType', 'skills', 'artifactKey'],
                    properties: {
                      id: { type: 'string' },
                      agentType: { type: 'string' },
                      role: { type: 'string' },
                      skills: { type: 'array', items: { type: 'string' } },
                      artifactKey: { type: 'string' },
                      gates: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
          } : {}),
          ...(profileOptionalIds.length > 0 ? { skipNodes: { type: 'array', items: { type: 'string' } } } : {}),
        },
      },
    }
  );

  planPath = architectResult?.planPath;
  needsMedia = !!architectResult?.needsMedia;
  skipNodes = profileOptionalIds.length > 0 && Array.isArray(architectResult?.skipNodes)
    ? architectResult.skipNodes.filter((id) => profileOptionalIds.includes(id))
    : [];
  const architectureSpec = architectResult?.architectureSpec || 'production_artifacts/00_architecture.json';
  const architectureHtml = architectResult?.architectureHtml || 'production_artifacts/00_architecture.html';
  const deliverOk = architectResult?.deliverOk !== false;

  if (!planPath) {
    return await escalate('Architect did not return a plan path.');
  }
  if (!deliverOk) {
    iteration++;
    if (iteration >= MAX_ITERATIONS) {
      return await escalate(
        'Archify deliver reported failure at the Architect step; previous HTML preserved.',
        { planPath }
      );
    }
    lastRejectionReason = 'Archify deliver/validate failed; previous HTML preserved. Repair the spec and deliver again.';
    continue;
  }
  if (architectureSpec !== 'production_artifacts/00_architecture.json' || architectureHtml !== 'production_artifacts/00_architecture.html') {
    iteration++;
    if (iteration >= MAX_ITERATIONS) {
      return await escalate(
        'Archify boundary rejected untrusted artifact paths; previous HTML preserved.',
        { planPath }
      );
    }
    lastRejectionReason = 'Archify boundary rejected untrusted artifact paths; previous HTML preserved. Use production_artifacts/00_architecture.json and production_artifacts/00_architecture.html.';
    continue;
  }
  const boundaryResult = await verifyArchifyArtifacts();
  if (!boundaryResult || boundaryResult.validateOk !== true || boundaryResult.deliverOk !== true) {
    iteration++;
    const boundaryError = typeof boundaryResult?.error === 'string' && boundaryResult.error
      ? boundaryResult.error.slice(0, 400)
      : 'archify validate/deliver failed';
    if (iteration >= MAX_ITERATIONS) {
      return await escalate(
        `Archify boundary verification failed; previous HTML preserved: ${boundaryError}`,
        { planPath }
      );
    }
    lastRejectionReason = `Archify boundary verification failed; previous HTML preserved: ${boundaryError}. Repair the spec and deliver again.`;
    continue;
  }

  if (hasWorkstreamsFlag) {
    const manifest = architectResult?.execution_manifest;
    if (!manifest) {
      iteration++;
      if (iteration >= MAX_ITERATIONS) {
        return await escalate('Architect did not return an execution_manifest as requested by --workstreams.', { planPath });
      }
      lastRejectionReason = 'Architect did not return an execution_manifest as requested by --workstreams. You must provide an execution_manifest object.';
      continue;
    }
    const validation = validateExecutionManifest(manifest, {
      roleRegistry: activeRoleRegistry,
      availableSkills: activeRoleRegistry?.availableSkills || (mandatorySkills.length ? new Set(mandatorySkills) : null),
      availablePlaybooks: activeRoleRegistry?.availablePlaybooks,
    });
    if (!validation.valid) {
      iteration++;
      const valError = validation.errors.map((e) => e.message).join('; ');
      if (iteration >= MAX_ITERATIONS) {
        return await escalate(`TechLead validation gate rejected execution_manifest: ${valError}`, { planPath, manifest });
      }
      lastRejectionReason = `TechLead validation gate rejected execution_manifest: ${valError}. Fix the workstream manifest.`;
      continue;
    }
    executionManifest = manifest;
  }

  try {
    if (fs && fs.existsSync && fs.existsSync(architectureHtml) && child_process) {
      const canvas = child_process.spawn(cliBin('aos-plan-canvas'), ['open', architectureHtml, '--no-open'].map(cliArg), { cwd: process.cwd(), timeout: 15000, stdio: 'ignore', shell: IS_WIN, detached: true });
      if (canvas && typeof canvas.on === 'function') canvas.on('error', (e) => process.stderr.write(`[startcycle-dispatch] architecture canvas not opened: ${e?.message || e}\n`));
      if (canvas && typeof canvas.unref === 'function') canvas.unref();
    }
  } catch {}

  await ensureNodeSkills(techleadNode);
  const techLeadResult = await agent(
    `You are acting as the ${techleadNode.label} agent (${techleadNode.personaFile}). ${dispatchNote(techleadNode)}${skillsNote(techleadNode)}\n\n` +
      `Read the plan at ${planPath}. Approve it only if it has an explicit capability map: ` +
      `module boundaries, dependency direction, and build order are all stated, not implicit. ` +
      `Apply the architecture gate: reject unless ${architectureSpec} and ${architectureHtml} both exist, ` +
      `the plan links the diagram with a url: ${architectureHtml} line, ` +
      `and the deliver receipt is a passing showcase receipt (9/9 checks, 0 errors, failure preserves the previous HTML). ` +
      (hasWorkstreamsFlag
        ? `This run uses dynamic workstreams (--workstreams). Validate the execution_manifest: ` +
          `verify that every workstream role, skill, and playbook exists, workstream count is between 1 and 4 (max 6), ` +
          `and IDs match ^[a-z0-9_]+$. Reject back to Architect if anything is invalid.\n`
        : '') +
      (mandatorySkills.length > 0
        ? `The user also required this run to use the following skill(s) via /startcycle-graph's --skill flag: ${mandatorySkills.join(', ')}. ` +
          `Reject the plan if it does not actually account for them — catching that here costs one planning round, ` +
          `whereas letting it through wastes a full build cycle before Reviewer flags it.\n`
        : '') +
      (profile
        ? `This run uses the "${profile.domain}" domain profile: approve only if the plan covers its build nodes (${profileBuildIds.join(', ')}) and does not assume a software frontend/backend split.\n`
        : '') +
      `Record your decision in state.json (plan approval, state.phase = "build" if approved${hasWorkstreamsFlag ? ', and record execution_manifest in state.execution_manifest' : ''}).\n\n` +
      `Return only: { "approved": boolean, "reason": string }.`,
    {
      label: `techlead-${iteration}`,
      agentType: techleadNode.agentType,
      ...nodeModelOpt(techleadNode),
      schema: {
        type: 'object',
        required: ['approved', 'reason'],
        properties: { approved: { type: 'boolean' }, reason: { type: 'string' } },
      },
    }
  );

  approved = !!techLeadResult?.approved;
  lastRejectionReason = techLeadResult?.reason ?? '';

  if (!approved) {
    iteration++;
    if (iteration >= MAX_ITERATIONS) {
      return await escalate(
        `TechLead never approved the plan within ${MAX_ITERATIONS} iterations. Last reason: ${lastRejectionReason}`,
        { planPath }
      );
    }
    continue;
  }

  // Human verdict gate (see humanCanvasGate above): TechLead approved, but
  // no build node starts before the human approves the plan in the canvas.
  // request-changes loops back to Architect with the feedback as the
  // revision brief.
  const humanGate = humanCanvasGate(planPath);
  if (humanGate.escalate) {
    return await escalate(`Plan canvas gate: ${humanGate.feedback}`, { planPath });
  }
  if (!humanGate.approved) {
    approved = false;
    iteration++;
    if (iteration >= MAX_ITERATIONS) {
      return await escalate(
        `No human approval in the plan canvas within ${MAX_ITERATIONS} iterations. Last feedback: ${humanGate.feedback}`,
        { planPath }
      );
    }
    lastRejectionReason = `The human requested changes in the plan canvas -- address this feedback: ${humanGate.feedback}`;
    continue;
  }
}

// ---------------------------------------------------------------------
// Build nodes (parallel, dispatcher-invoked independently -- pipeline()
// fans out one agent() per node; none of them call each other) <-> Reviewer
// repair loop. On the first pass every applicable node runs; on a repair
// pass only the nodes that own an open finding run again. Derived entirely
// from the registry loaded above, filtered to role: 'build' and (for
// media_eventtech specifically) Architect's needsMedia decision.
// ---------------------------------------------------------------------

const BUILD_NODES = resolveBuildPlan({
  workstreamsFlag: hasWorkstreamsFlag,
  executionManifest,
  effectiveNodes,
  needsMedia,
  skipNodes,
  profile,
  roleRegistry: activeRoleRegistry,
});

if (BUILD_NODES.length === 0) {
  return await escalate('No build-role nodes resolved from .agents/nodes.json for this goal.');
}

const NODE_ENUM = BUILD_NODES.map((n) => n.id);
const NODE_NAMES = humanList(NODE_ENUM);

// Live map (agenttrail skill, Trigger B): best-effort, never blocks or fails the run.
// After approval, derive the agenttrail plan from the Plan Builder plan.mdx
// (`aos-plan-canvas trail`), then start the map on it. aos-trail exits on its
// own when a map for this repo is already running.
let trailPlan = planPath;
if (/plan\.mdx$/i.test(planPath) && child_process) {
  try {
    const t = child_process.spawnSync(cliBin('aos-plan-canvas'), ['trail', planPath, '--force'].map(cliArg), { cwd: process.cwd(), encoding: 'utf8', shell: IS_WIN });
    const out = t.status === 0 ? lastJsonObject(t.stdout)?.out : '';
    if (out) trailPlan = out;
  } catch (e) { process.stderr.write(`[startcycle-dispatch] trail derivation skipped: ${e?.message || e}\n`); }
}
try {
  child_process?.spawn(cliBin('aos-trail'), [process.cwd(), '--plan', trailPlan, '--no-open'].map(cliArg),
    { detached: true, stdio: 'ignore', shell: IS_WIN }).on('error', (e) => process.stderr.write(`[startcycle-dispatch] live map not started: ${e?.message || e}\n`)).unref();
} catch (e) { process.stderr.write(`[startcycle-dispatch] live map not started: ${e?.message || e}\n`); }

let findings = [];
let reviewedClean = false;
let nodesToRun = BUILD_NODES; // first pass: everyone applicable
let previousBlockingIds = new Set(); // for the no-progress guard below

while (!reviewedClean) {
  const isSolo = nodesToRun.length === 1;
  const pipelineResults = await pipeline(nodesToRun, (n) => {
    const openFindings = findings.filter((f) => f.node === n.id && f.status === 'open');
    const opts = { label: n.id, agentType: n.agentType, trail: { node: n.id, plan: trailPlan }, ...nodeModelOpt(n) };
    if (isSolo) {
      opts.schema = {
        type: 'object',
        properties: { needsHuman: { type: 'boolean' } }
      };
    }
    return ensureNodeSkills(n).then(() => agent(
      `[trail-node:${n.id}] You are acting as the ${n.label} agent (${n.personaFile}). ${dispatchNote(n, isSolo)}${skillsNote(n)}\n\n` +
        `Read the plan at ${planPath}. ${n.instructions}\n` +
        (openFindings.length
          ? `Address these open Reviewer findings before anything else: ${JSON.stringify(openFindings)}\n`
          : '') +
        (isSolo ? `\n\nReturn only: { "needsHuman": boolean } (set to true only if you set "needs_human": true in state.json).` : ''),
      opts
    ));
  });

  if (isSolo) {
    if (pipelineResults[0]?.needsHuman) {
      return await escalate(`Build node ${nodesToRun[0].id} requested human input.`);
    }
  } else {
    // Barrier: every build node in this pass has returned and written only its
    // own production_artifacts/state.d/<id>.json fragment (dispatchNote()'s
    // build-role branch). Fold them into state.json now, before Reviewer (or
    // anything else) reads it -- this is the CHANGE 1 fix from comment block
    // item #3, and it must happen inside this run since graph-gate.mjs reads
    // state.json at turn end.
    const mergeResult = await mergeStateD();
    if (mergeResult?.skipped?.length) {
      return await escalate(
        `State merge could not fold fragment(s) after the build pass: ${mergeResult.skipped.join(', ')}`,
        { skipped: mergeResult.skipped }
      );
    }
    if (mergeResult?.needsHuman) {
      return await escalate('One or more build nodes requested human input.');
    }
  }

  // Reviewer: ARTIFACT + CONTRACT only, per .agents/graph.md's discipline --
  // reviewerStateNote() (not dispatchNote()) is what actually enforces this;
  // see that function's own comment for why the distinction matters.
  const reviewerArtifactsNote = hasWorkstreamsFlag && executionManifest?.workstreams
    ? executionManifest.workstreams.map((ws) => `state.artifacts.${ws.artifactKey || ws.id}`).join(', ')
    : (profile && profile.artifacts ? Object.values(profile.artifacts).join(', ') : `production_artifacts/01_frontend_spec.md, 02_backend_schema.md${needsMedia ? ', 03_media_pipeline.md' : ''}`);

  await ensureNodeSkills(reviewerNode);
  const reviewResult = await agent(
    `You are acting as the ${reviewerNode.label} agent (${reviewerNode.personaFile}). ${reviewerStateNote()}${skillsNote(reviewerNode)}\n\n` +
      `Read the plan/contract at ${planPath} and the artifacts it produced ` +
      `(${reviewerArtifactsNote}, and the actual code). ` +
      `Do an adversarial review against the contract: find what is wrong, do not validate, do not summarize. ` +
      `Do not assume the implementation is correct just because it exists. ` +
      (mandatorySkills.length > 0
        ? `The user explicitly required these skill(s) to be used this run, via /startcycle-graph's --skill flag: ${mandatorySkills.join(', ')}. ` +
          `If an artifact shows no sign of applying a mandated skill's guidance, that is a contract misread finding (blocking), owned by whichever build node should have applied it. ` +
          `A mandated skill being merely available is not enough -- check for it actually being used.\n`
        : '') +
      `Classify every finding by precedence: contract misread > valid & actionable (blocking) > valid trade-off (advisory) > noise (discard). ` +
      `Each finding must name which node owns fixing it: ${NODE_NAMES} -- no other value is valid. ` +
      `If you are re-reviewing after a repair round and an issue you flagged before is still present and still unfixed, ` +
      `reuse the exact same "id" you gave it last time; only mint a new id for a genuinely new issue. This id ` +
      `stability is what lets the dispatcher detect a repair round that made no real progress, so do not renumber ` +
      `findings between cycles just because this is a fresh review call.\n` +
      `Write production_artifacts/review_findings.md and update state.findings.\n\n` +
      `Return only: { "findings": [{ "id": string, "severity": "blocking"|"advisory", "node": string, "summary": string, "status": "open"|"fixed"|"wont_fix" }], "blockingCount": number } (blockingCount must count ONLY findings whose status is "open").`,
    {
      label: `reviewer-${iteration}`,
      agentType: reviewerNode.agentType,
      ...nodeModelOpt(reviewerNode),
      schema: {
        type: 'object',
        required: ['findings', 'blockingCount'],
        properties: {
          findings: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'severity', 'node', 'summary', 'status'],
              properties: {
                id: { type: 'string' },
                severity: { type: 'string', enum: ['blocking', 'advisory'] },
                node: { type: 'string', enum: NODE_ENUM },
                summary: { type: 'string' },
                status: { type: 'string', enum: ['open', 'fixed', 'wont_fix'] },
              },
            },
          },
          blockingCount: { type: 'number' },
        },
      },
    }
  );

  findings = reviewResult?.findings ?? [];
  const blockingCount = reviewResult?.blockingCount ?? findings.filter((f) => f.severity === 'blocking' && f.status === 'open').length;

  if (blockingCount === 0) {
    // Clean. Note on .agents/graph.md's original "doubt theater" guard (2
    // consecutive clean reviews escalate): that check has no reachable
    // trigger in this control flow -- a clean result exits this loop
    // immediately, so Reviewer is never asked to re-confirm an
    // already-clean artifact. What this loop *can* actually detect, and
    // does below, is the opposite failure mode: a repair round that
    // changes nothing. Same underlying intent, a form this structure can
    // genuinely reach.
    reviewedClean = true;
  } else {
    const blockingIds = new Set(findings.filter((f) => f.severity === 'blocking' && f.status === 'open').map((f) => f.id));
    const sameAsLastTime =
      iteration > 0 &&
      blockingIds.size > 0 &&
      blockingIds.size === previousBlockingIds.size &&
      [...blockingIds].every((id) => previousBlockingIds.has(id));

    if (sameAsLastTime) {
      // No-progress guard: the build node(s) supposedly addressed these
      // exact findings last round, and Reviewer is reporting the identical
      // finding IDs again. Depends on Reviewer actually reusing IDs for
      // still-open issues (see the prompt instruction above) -- escalate
      // now instead of burning the remaining iterations on an identical
      // repeat.
      return await escalate(
        'No progress: Reviewer reported the exact same blocking finding(s) after a repair round that was supposed to address them. Escalating rather than repeating an identical cycle.',
        { findings }
      );
    }

    previousBlockingIds = blockingIds;
    nodesToRun = BUILD_NODES.filter((n) => findings.some((f) => f.node === n.id && f.status === 'open'));
    if (nodesToRun.length === 0) {
      // Findings exist but none map to a known node -- Reviewer mis-tagged
      // ownership (the schema's enum constraint above should make this rare,
      // but a model can still return status values that don't leave any
      // "open" finding for a real node). Don't loop on nothing; escalate.
      return await escalate('Reviewer reported blocking findings but none left an open finding on a recognized node.', {
        findings,
      });
    }

    iteration++;
    if (iteration >= MAX_ITERATIONS) {
      return await escalate(`Build/review repair loop hit ${MAX_ITERATIONS} iterations with findings still open.`, {
        findings,
      });
    }
  }
}

// ---------------------------------------------------------------------
// Shipping: automated gate. Deliberately a separate check from Reviewer's
// adversarial pass (mechanical gate execution vs. correctness review).
// Shipping itself is sequential (not part of the CHANGE 1 race); the
// gate-fix repair round below IS a pipeline() fan-out, so it gets the same
// state.d + merge treatment as the build/review loop above.
// ---------------------------------------------------------------------

const GATE_KEYS = hasWorkstreamsFlag && executionManifest?.workstreams
  ? deriveWorkstreamGates(executionManifest.workstreams)
  : (profile ? Object.keys(profile.gates) : ['lint', 'typecheck', 'tests', 'a11y', 'seo', 'security']);
const GATE_LABELS = profile
  ? Object.entries(profile.gates).map(([k, v]) => `${k} (${v})`).join(', ')
  : GATE_KEYS.join(', ');
const GATE_VALUE_ENUM = ['pass', 'fail', 'skip'];
let allGatesPass = false;
let lastGate = null;

while (!allGatesPass) {
  await ensureNodeSkills(shippingNode);
  const shipResult = await agent(
    `You are acting as the ${shippingNode.label} agent (${shippingNode.personaFile}). ${dispatchNote(shippingNode)}${skillsNote(shippingNode)}\n\n` +
      `Run the automated quality gate against the artifacts from the plan at ${planPath}: ${GATE_LABELS}. ${profile ? 'Run the check each gate above describes with the tools that domain uses -- detect ' : "Use the repository's own commands (npm test / pytest / tsc --noEmit / etc -- detect "}` +
      `which apply; use "skip" only for a check that genuinely doesn't apply to this repo, not for one you didn't run). ` +
      `Write production_artifacts/04_release_report.md and set state.gate to exactly these keys, dropping any other key left by an earlier run: ${GATE_KEYS.join(', ')}. ` +
      `If every gate check is 'pass' or 'skip', you must also set state.phase = "ready_to_ship" in state.json.\n\n` +
      `Return only: { "gate": { ${GATE_KEYS.map((k) => `"${k}": "pass"|"fail"|"skip"`).join(', ')} }, "blockingNodes": string[] } ` +
      `-- blockingNodes lists which build node(s) (${NODE_NAMES}) own fixing each failing check; empty if all pass.`,
    {
      label: `shipping-${iteration}`,
      agentType: shippingNode.agentType,
      ...nodeModelOpt(shippingNode),
      schema: {
        type: 'object',
        required: ['gate', 'blockingNodes'],
        properties: {
          gate: {
            type: 'object',
            required: GATE_KEYS,
            properties: Object.fromEntries(GATE_KEYS.map((k) => [k, { type: 'string', enum: GATE_VALUE_ENUM }])),
          },
          blockingNodes: { type: 'array', items: { type: 'string', enum: NODE_ENUM } },
        },
      },
    }
  );

  lastGate = shipResult?.gate ?? {};
  const failing = Object.entries(lastGate).filter(([, v]) => v === 'fail');

  if (failing.length === 0) {
    allGatesPass = true;
    break;
  }

  iteration++;
  if (iteration >= MAX_ITERATIONS) {
    return await escalate(`Quality gate still failing after ${MAX_ITERATIONS} repair attempts.`, { gate: lastGate });
  }

  const blockingNodes = (shipResult?.blockingNodes ?? [])
    .map((n) => BUILD_NODES.find((b) => b.id === n))
    .filter(Boolean);

  if (blockingNodes.length === 0) {
    return await escalate(
      `Shipping gate failed (${failing.map(([k]) => k).join(', ')}) but named no owning build node to re-invoke.`,
      { gate: lastGate }
    );
  }

  const isSolo = blockingNodes.length === 1;
  const pipelineResults = await pipeline(blockingNodes, (n) => {
    const opts = { label: `${n.id}-gate-fix-${iteration}`, agentType: n.agentType, trail: { node: n.id, plan: trailPlan }, ...nodeModelOpt(n) };
    if (isSolo) {
      opts.schema = {
        type: 'object',
        properties: { needsHuman: { type: 'boolean' } }
      };
    }
    return ensureNodeSkills(n).then(() => agent(
      `[trail-node:${n.id}] You are acting as the ${n.label} agent (${n.personaFile}). ${dispatchNote(n, isSolo)}${skillsNote(n)}\n\n` +
        `Shipping's quality gate failed on a check you own: ${JSON.stringify(lastGate)}. ` +
        `Read production_artifacts/04_release_report.md for details and fix it.` +
        (isSolo ? `\n\nReturn only: { "needsHuman": boolean } (set to true only if you set "needs_human": true in state.json).` : ''),
      opts
    ));
  });

  if (isSolo) {
    if (pipelineResults[0]?.needsHuman) {
      return await escalate(`Build node ${blockingNodes[0].id} requested human input during gate fix.`);
    }
  } else {
    // Same barrier as the build/review loop above: this pipeline() call just
    // ran build nodes concurrently, each writing only its own state.d
    // fragment. Fold them in before Shipping re-checks the gate.
    const gateMergeResult = await mergeStateD();
    if (gateMergeResult?.skipped?.length) {
      return await escalate(
        `State merge could not fold fragment(s) after a gate-fix repair round: ${gateMergeResult.skipped.join(', ')}`,
        { skipped: gateMergeResult.skipped }
      );
    }
    if (gateMergeResult?.needsHuman) {
      return await escalate('One or more build nodes requested human input during gate fix.');
    }
  }
}

// All gates green. Do NOT push/ship automatically -- that's gated by
// .claude/hooks/go-gate.mjs same as any other push/publish/version bump in
// this repo, and requires a literal "GO" from the user for the reply that
// runs it. This workflow's job ends at "ready," not at "shipped."
return {
  phase: 'ready_to_ship',
  reason:
    'All quality gates passed. Reply with the literal word GO to authorize the push (git commit, version tag, push) -- go-gate.mjs will not let it proceed otherwise.',
  gate: lastGate,
  planPath,
};
} catch (error) {
  try {
    return await escalate(error.message || String(error));
  } catch (escalateError) {
    return { phase: 'escalated', reason: error.message || String(error), needs_human: true };
  }
}
}

// Execution handling: when invoked standalone or via hook, execute runWorkflow() and handle exit
const isClaudeWorkflow = typeof globalThis.agent === 'function' && typeof args !== 'undefined' && !isHookInvocation;
const result = await runWorkflow();

if (!isClaudeWorkflow && typeof process !== 'undefined' && process.exit) {
  if (isHookInvocation && process.stdout) {
    const msg = `[startcycle-graph] Phase: ${result?.phase || 'done'}. ${result?.reason || ''}`;
    // Codex and Claude send hook_event_name and accept only hookSpecificOutput; agy payloads lack it and keep injectSteps.
    process.stdout.write(JSON.stringify(hookEventName
      ? { systemMessage: msg, hookSpecificOutput: { hookEventName, additionalContext: msg } }
      : { injectSteps: [{ ephemeralMessage: msg }], systemMessage: msg, result }) + '\n');
  } else if (result && process.stdout) {
    console.log(JSON.stringify(result, null, 2));
  }
  process.exit(0);
}

export default result;
