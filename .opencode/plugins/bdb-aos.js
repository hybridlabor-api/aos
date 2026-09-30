/**
 * BDB Agent OS (AOS) plugin for OpenCode.
 *
 * Implements:
 * 1. tool.execute.before: Releases gatekeeper (go-gate). Guards outward-facing
 *    or hard-to-reverse actions (git push, npm publish, npm version, rm -rf)
 *    unless the user explicitly authorized it with the literal word "GO".
 * 2. chat.message: Ambient memory injection (memB). Injects relevant project & user
 *    memories as ephemeral context from ~/.MemBDB/memb.db via node:sqlite.
 * 3. tool.execute.before/after: Best-effort live-map telemetry for the AOS
 *    agenttrail daemon (PreToolUse/PostToolUse, fire-and-forget).
 *
 * Zero external runtime dependencies. Fails open on memory lookup, fails closed
 * on unguarded destructive actions.
 */

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GUARDED_PATTERNS = [
  /(?:^|[;&|]\s*)git\s+push\b/i,
  /(?:^|[;&|]\s*)npm\s+publish\b/i,
  /(?:^|[;&|]\s*)npm\s+version\b/i,
  /(?:^|[;&|]\s*)gh\s+pr\s+merge\b/i,
  /(?:^|[;&|]\s*)gh\s+release\s+create\b/i,
  /(?:^|[;&|]\s*)git\s+reset\s+--hard\b/i,
  /(?:^|[;&|]\s*)git\s+clean\s+-[a-zA-Z]*f\b/i,
  /(?:^|[;&|]\s*)rm\s+(?:-\w*[rR]\w*|--recursive)\b/i,
];

let lastHumanPrompt = '';

// ---------------------------------------------------------------------------
// Graph gate (W-5, W-6)
//
// The loop-keeper for /startcycle-graph on a harness with no Stop hook. Claude
// Code blocks the exit in .claude/hooks/graph-gate.mjs; OpenCode has no Stop
// event, so the same contract is kept by nudging the session awake on
// session.idle while production_artifacts/state.json still has open work.
//
// This is deliberately dumb: it reads state.json and it prompts. It never
// dispatches a node, never decides who runs next, and never writes state.json --
// the dispatcher owns that file, and a gate that writes the state it is
// measured against proves nothing. Everything here fails open.
// ---------------------------------------------------------------------------

const STATE_REL = path.join('production_artifacts', 'state.json');
const TERMINAL_PHASES = new Set(['done', 'escalated']);
const GATE_FIELDS = ['lint', 'typecheck', 'tests', 'a11y', 'seo', 'security'];
// Bounded so a stalled run nudges and then goes quiet instead of looping. The
// ceiling mirrors state.max_iterations; past it the human is the loop-breaker.
const MAX_NUDGES = 3;

const PIPELINE_COMMANDS = [
    { name: 'startcycle-graph', skill: 'startcycle-graph', goal: '' },
    { name: 'startcycle-graph-user', skill: 'startcycle-graph-user', goal: '' },
    { name: 'startcycle', skill: 'startcycle', goal: '' },
];

// sessionID -> { signature, nudges }
const nudgeState = new Map();

function readGraphState(directory) {
    if (!directory) return null;
    const p = path.join(directory, STATE_REL);
    try {
        if (!existsSync(p)) return null;
        const parsed = JSON.parse(readFileSync(p, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

// Returns null when nothing blocks, else { signature, text }.
function openGraphGate(state) {
    if (!state) return null;

    const reasons = [];

    const phase = typeof state.phase === 'string' ? state.phase : null;
    if (phase && !TERMINAL_PHASES.has(phase)) {
        reasons.push(`state.phase is "${phase}" (terminal phases: ${[...TERMINAL_PHASES].join(', ')})`);
    }

    const findings = Array.isArray(state.findings) ? state.findings : [];
    const openBlocking = findings
        .filter(f => f && f.severity === 'blocking' && f.status === 'open')
        .map(f => f.id || '<unnamed>');
    if (openBlocking.length) {
        reasons.push(`${openBlocking.length} open blocking finding(s): ${openBlocking.join(', ')}`);
    }

    const gate = state.gate && typeof state.gate === 'object' ? state.gate : null;
    if (gate) {
        const failed = GATE_FIELDS.filter(f => gate[f] === 'fail').map(f => `gate.${f}`);
        if (failed.length) reasons.push(`quality gate failing: ${failed.join(', ')}`);
    }

    if (!reasons.length) return null;
    return {
        signature: `${phase}|${openBlocking.join(',')}|${reasons.length}`,
        text: reasons.join('; '),
    };
}

function buildGraphNudge(gate) {
    return [
        '[AOS Graph Gate] The /startcycle-graph run is not finished: ' + gate.text + '.',
        'Read production_artifacts/state.json and .agents/graph.md, then dispatch the',
        'next node the edge table requires. If state.iteration >= state.max_iterations,',
        'or a repair round reports the same blocking finding id again, set phase to',
        '"escalated" and hand control back to the user instead of looping.',
    ].join(' ');
}

// The pipeline group. /startcycle-graph also resolves natively from
// ~/.config/opencode/commands/startcycle-graph.md; this is the fallback for the
// names that have no command file, and it also covers a project that predates
// the payload.
function matchPipelineCommand(text) {
    const m = text.match(/^\/(startcycle(?:-graph-user|-graph)?)(?:\s+(.*))?$/is);
    if (!m) return null;
    return PIPELINE_COMMANDS.find(c => c.name === m[1].toLowerCase()) || null;
}

function isGuardedCommand(cmd) {
  if (typeof cmd !== 'string') return false;
  return GUARDED_PATTERNS.some((re) => re.test(cmd));
}

function verifyGoAuthorized(lastPrompt) {
  const trimmed = (lastPrompt || '').trim();
  return trimmed.toUpperCase() === 'GO';
}

// Best-effort fire-and-forget telemetry for the AOS live map (agenttrail daemon).
// 300 ms timeout per request, all errors swallowed, never throws. Self-contained
// on purpose: the plugin must not import from mcps/.
const pendingArgs = new Map();

async function postTrail(event) {
  const body = JSON.stringify(event);
  const ports = process.env.AGENTTRAIL_PORT
    ? [Number(process.env.AGENTTRAIL_PORT)]
    : Array.from({ length: 15 }, (_, i) => 5330 + i);
  await Promise.allSettled(
    ports.map((port) =>
      fetch(`http://127.0.0.1:${port}/hook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(300),
      }).catch(() => {})
    )
  );
}

function mapTrailToolName(name) {
  const lower = (name || '').toLowerCase();
  if (lower === 'edit') return 'Edit';
  if (lower === 'write') return 'Write';
  if (lower === 'bash') return 'Bash';
  if (lower === 'read') return 'Read';
  return lower ? lower.charAt(0).toUpperCase() + lower.slice(1) : '';
}

function mapTrailToolInput(args, directory) {
  const mapped = {};
  if (args && typeof args === 'object') {
    if (typeof args.filePath === 'string' && args.filePath) {
      mapped.file_path = path.resolve(directory, args.filePath);
    }
    if (typeof args.command === 'string') {
      mapped.command = args.command;
    }
  }
  return mapped;
}

// Extract ambient memory from local memB database
async function getMembContext(prompt, currentDir) {
  const home = os.homedir();
  const dbPath = path.join(home, '.MemBDB', 'memb.db');
  if (!existsSync(dbPath)) return null;

  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 3000;');

    const contextItems = [];

    // Standing persona facts
    const personaFile = path.join(home, '.MemBDB', 'ambient-persona.txt');
    if (existsSync(personaFile)) {
      try {
        for (const line of readFileSync(personaFile, 'utf8').split('\n')) {
          const t = line.trim();
          if (t && !t.startsWith('#')) contextItems.push(`- ${t}`);
        }
      } catch {}
    }

    // Resolve project ID candidate
    let projectName = path.basename(currentDir);
    const pkgPath = path.join(currentDir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg?.name) projectName = pkg.name;
      } catch {}
    }

    // Query project memories
    try {
      const sql = `
        SELECT payload FROM memb_vectors
        WHERE collection = 'bdb_agent_memory'
          AND (
            json_extract(payload, '$.project_id') = ?
            OR json_extract(payload, '$.metadata.project_id') = ?
            OR json_extract(payload, '$.project') = ?
            OR json_extract(payload, '$.metadata.project') = ?
          )
        ORDER BY rowid DESC
        LIMIT 3
      `;
      const rows = db.prepare(sql).all(projectName, projectName, projectName, projectName);
      for (const r of rows) {
        try {
          const p = JSON.parse(r.payload);
          const text = (p.memory || p.data || '').trim().replace(/\s+/g, ' ');
          if (text.length > 10) {
            contextItems.push(`- Project [${projectName}]: ${text.slice(0, 180)}`);
          }
        } catch {}
      }
    } catch {}

    db.close();

    if (contextItems.length === 0) return null;
    return `[AOS Ambient Memory - memB]\n${contextItems.join('\n')}`;
  } catch {
    return null;
  }
}

export default async function bdbAosPlugin(input) {
  const directory = input.directory || process.cwd();

  return {
    // W-6 loop-keeper. Fires whenever a session goes idle. Reads the graph
    // state and, while work is still open, prompts the session to continue.
    // Never throws: a graph that cannot be read must not wedge the session.
    event: async ({ event }) => {
      try {
        if (!event || event.type !== 'session.idle') return;
        const sessionID = event.properties && event.properties.sessionID;
        if (!sessionID || !input.client) return;

        const gate = openGraphGate(readGraphState(directory));
        if (!gate) return;

        const prev = nudgeState.get(sessionID);
        const nudges = prev ? prev.nudges : 0;
        // Nudge once per distinct state, and never more than the ceiling. An
        // unchanged gate is a stalled run, not a reason to loop.
        if (prev && prev.signature === gate.signature) return;
        if (nudges >= MAX_NUDGES) return;

        nudgeState.set(sessionID, { signature: gate.signature, nudges: nudges + 1 });
        await input.client.session.prompt({
          path: { id: sessionID },
          body: { parts: [{ type: 'text', text: buildGraphNudge(gate) }] },
          query: directory ? { directory } : undefined,
        });
      } catch {
        // Fail open. A graph gate that breaks the session is worse than no gate.
      }
    },

    'chat.message': async (msgInput, msgOutput) => {
      // Capture the user prompt text for GO-gate verification
      const textParts = (msgOutput.parts || []).filter((p) => p && p.type === 'text' && typeof p.text === 'string');
      const fullText = textParts.map((p) => p.text).join('\n').trim();
      if (fullText) {
        lastHumanPrompt = fullText;
      }

      // Inject memB ambient memory
      try {
        const membContext = await getMembContext(fullText, directory);
        if (membContext) {
          msgOutput.parts.unshift({
            id: `memb-${Date.now()}`,
            sessionID: msgInput.sessionID,
            messageID: msgInput.messageID || '',
            type: 'text',
            text: membContext,
            synthetic: true,
          });
        }
      } catch {}

      // Recognize and wire the AOS pipeline group
      const pipeline = matchPipelineCommand(fullText);
      if (pipeline) {
        const goal = fullText.slice(pipeline.name.length + 1).trim();
        const graphInstructions = [
          `[AOS Pipeline - ${pipeline.name} - Active]`,
          `Goal: "${goal || 'Execute planned architecture cycle'}"`,
          `Skill: skills/basic/${pipeline.skill}/SKILL.md`,
          `State Schema: .agents/state.schema.json`,
          `Persisted State: production_artifacts/state.json`,
          `Available Nodes: .agents/nodes.json (Architect -> TechLead -> Build [UI_UX, Engineering, Media] -> Reviewer -> Shipping)`,
          `Rule: Nodes never call each other. Dispatch each node turn in sequence, evaluate state.json, and enforce Reviewer & Shipping gates before completion.`
        ].join('\n');

        msgOutput.parts.unshift({
          id: `startcycle-${Date.now()}`,
          sessionID: msgInput.sessionID,
          messageID: msgInput.messageID || '',
          type: 'text',
          text: graphInstructions,
          synthetic: true,
        });
      }
    },

    'tool.execute.before': async (toolInput, toolOutput) => {
      // Live-map telemetry first; must never affect the go-gate logic below.
      try {
        const tool_name = mapTrailToolName(toolInput.tool);
        const tool_input = mapTrailToolInput(toolOutput?.args, directory);
        pendingArgs.set(toolInput.callID, tool_input);
        postTrail({
          hook_event_name: 'PreToolUse',
          session_id: toolInput.sessionID,
          cwd: directory,
          agent: 'opencode',
          tool_name,
          tool_input,
        });
      } catch {}
      const toolName = (toolInput.tool || '').toLowerCase();
      // Intercept bash, terminal, or command execution tools
      if (toolName === 'bash' || toolName === 'terminal' || toolName === 'shell' || toolName === 'exec' || toolName === 'run_command') {
        const cmd = toolOutput?.args?.command || toolOutput?.args?.cmd || toolOutput?.args?.script || '';
        if (isGuardedCommand(cmd)) {
          let authorized = verifyGoAuthorized(lastHumanPrompt);

          // If last cached prompt wasn't GO, query recent session messages via OpenCode client as fallback
          if (!authorized && input.client && toolInput.sessionID) {
            try {
              const res = await input.client.session.messages({ path: { id: toolInput.sessionID } });
              const msgs = res?.data || [];
              for (let i = msgs.length - 1; i >= 0; i--) {
                const m = msgs[i];
                if (m.role === 'user') {
                  const parts = m.parts || [];
                  const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n').trim();
                  if (text) {
                    authorized = (text.toUpperCase() === 'GO');
                    break;
                  }
                }
              }
            } catch {}
          }

          if (!authorized) {
            throw new Error(
              `Blocked by BDB go-gate: Command "${cmd.slice(0, 80)}" is guarded and requires explicit authorization with the literal word "GO" before proceeding.`
            );
          }
        }
      }
    },

    'tool.execute.after': async (toolInput) => {
      try {
        const tool_input = pendingArgs.get(toolInput.callID);
        pendingArgs.delete(toolInput.callID);
        postTrail({
          hook_event_name: 'PostToolUse',
          session_id: toolInput.sessionID,
          cwd: directory,
          agent: 'opencode',
          tool_name: mapTrailToolName(toolInput.tool),
          tool_input,
        });
      } catch {}
    },
  };
}
