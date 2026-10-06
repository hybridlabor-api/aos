/**
 * BDB Agent OS (AOS) plugin for OpenCode.
 *
 * Implements:
 * 1. tool.execute.before: Releases gatekeeper (go-gate). Guards outward-facing
 *    or hard-to-reverse actions (git push, npm publish, npm version, rm -rf)
 *    unless the user explicitly authorized it with the literal word "GO", or a
 *    master session issued a GO token for this session (~/.aos/go/<name>.token).
 * 2. chat.message: Ambient memory injection (memB). Injects relevant project & user
 *    memories as ephemeral context from ~/.MemBDB/memb.db via node:sqlite.
 * 3. tool.execute.before/after: Best-effort live-map telemetry for the AOS
 *    agenttrail daemon (PreToolUse/PostToolUse, fire-and-forget).
 *
 * Zero external runtime dependencies. Fails open on memory lookup, fails closed
 * on unguarded destructive actions.
 */

import { existsSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';

// Decision logic lives in the shared hooks: installed copy next to this file
// (plugins/aos-hooks), else the repo's .claude/hooks. existsSync, not try/catch,
// so a broken installed hook fails loudly instead of silently falling back.
const HOOKS = existsSync(new URL('./aos-hooks/go-gate.mjs', import.meta.url)) ? './aos-hooks/' : '../../.claude/hooks/';
const hook = (f) => import(new URL(HOOKS + f, import.meta.url).href);
// `opencode run "..."` is scriptable by an agent, so it never sets gogate modes or grants
const OPENCODE_RUN = process.argv.slice(1, 4).includes('run');
const [gate, { issueGoToken }, { checkConventionalCommit }, { envFileReason }, { buildMemoryBlock }, bus, { applyGogate }] =
  await Promise.all(['go-gate.mjs', 'go-token.mjs', 'conventional-commits.mjs', 'env-file-protection.mjs', 'memb-inject.mjs', 'aos-bus.mjs', 'go-grant.mjs'].map(hook));
const { GUARDED_PATTERNS, tokenGrantsGo, isHumanPart, parseGoText, goAllows, isGuardedCommand, gateStoreReason, effectiveGate, opencodeGogateCommands, grantsCover, sessionKey, gateLog, hardBlockReason, setGateContext, readBlockTs, markBlock, analyzeDeletes, COOLDOWN_MESSAGE } = gate;

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

// This session's name for the token: env (set by aos-acp / the user), else the
// OpenCode session title.
async function ownSessionName(client, sessionID) {
  if (process.env.AOS_SESSION_NAME) return process.env.AOS_SESSION_NAME;
  try {
    const res = await client?.session?.get?.({ path: { id: sessionID } });
    return res?.data?.title || '';
  } catch { return ''; }
}

// Only plain text parts are human turns: synthetic = model-only, ignored = display-only,
// aos_bus / aos_loop (any loop|aos_ metadata key) = plugin-injected. Each excluded on its own,
// so safety never hangs on one flag.
const isHumanText = isHumanPart;
const isNonHuman = (p) => !!p && !!(p.synthetic || p.ignored || (p.metadata && typeof p.metadata === 'object' && Object.keys(p.metadata).some((k) => /loop|aos_/i.test(k))));
const ocKey = (id) => sessionKey(`oc-${id}`);

// Root of a session tree (grants live on the root, subagents may use them). null when unknown.
async function rootSessionId(client, id, parentID) {
  for (let i = 0; i < 10 && id; i++) {
    if (parentID === null) return id;
    try {
      const res = await client?.session?.get?.({ path: { id } });
      if (!res?.data) return null;
      if (!res.data.parentID) return id;
      id = res.data.parentID;
      parentID = undefined;
    } catch { return null; }
  }
  return null;
}

// A plugin reload (SIGUSR2) re-runs init on the cached module in the same process:
// stop the previous instance's timers and keep its bus names alive. Keyed by directory.
const busInstances = new Map();

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

// Live-map autostart: on the first subagent spawn per session, ensure the agenttrail map runs
// and show its URL. Best-effort; never affects the gate logic.
const trailSeen = new Set();
async function trailAutostart(toolInput, directory, client) {
  try {
    const lib = await import('./lib/trail-autostart.js');
    if (!lib.isSpawnTool(toolInput.tool) || trailSeen.has(toolInput.sessionID)) return;
    const r = lib.trailEnsure({ cwd: directory, sessionId: toolInput.sessionID });
    if (!r) return;
    trailSeen.add(toolInput.sessionID);
    await client?.tui?.showToast?.({
      body: { title: 'AOS agenttrail', message: r.url, variant: 'info' },
    });
  } catch {}
}

export default async function bdbAosPlugin(input) {
  const directory = input.directory || process.cwd();

  // ponytail: entries live for the process lifetime (a few bytes per session); add cleanup if sessions ever pile up.
  const sessions = new Map();
  const sess = (id) => {
    if (!sessions.has(id)) sessions.set(id, { prompt: '', parentID: null, identitySent: false });
    return sessions.get(id);
  };
  // aos-bus: bus name -> sessionID of the root session that owns it.
  const prevBus = busInstances.get(directory);
  for (const t of prevBus?.timers || []) clearInterval(t);
  const busNames = prevBus?.names || new Map();
  const busTimers = [];
  busInstances.set(directory, { timers: busTimers, names: busNames });
  const every = (ms, fn) => { const t = setInterval(fn, ms); t.unref?.(); busTimers.push(t); };
  const BUS_PROMPT_TIMEOUT_MS = Number(process.env.AOS_BUS_PROMPT_TIMEOUT_MS) || 10 * 60 * 1000;
  const BUS_BUSY_MAX_MS = Number(process.env.AOS_BUS_BUSY_MAX_MS) || 10 * 60 * 1000;
  const ensureBus = async (id, parentID) => {
    const s = sess(id);
    if (s.bus || !id) return;
    s.bus = true;
    try {
      if (parentID === undefined) {
        const res = await input.client?.session?.get?.({ path: { id } });
        if (!res?.data) { s.bus = false; return; }
        parentID = res.data.parentID ?? null;
      }
      if (parentID) return;
      const name = bus.registerSession({ name: process.env.AOS_SESSION_NAME || id, sessionID: id, cwd: directory });
      busNames.set(name, id);
    } catch (e) {
      console.error(`[aos-bus] registration failed: ${e?.message}`);
      s.bus = /invalid session name/.test(e?.message);
    }
  };
  const dropBus = (id) => {
    for (const [name, sid] of busNames) if (sid === id) { bus.unregisterSession(name); busNames.delete(name); }
  };
  process.on('exit', () => { for (const name of busNames.keys()) bus.unregisterSession(name); });

  // Heartbeat on its own timer (the poll loop can sit in one prompt for minutes); readers drop a
  // registration whose mtime is older than bus.STALE_MS. touchSession only touches this pid's files.
  every(5000, () => { for (const name of busNames.keys()) bus.touchSession(name); });

  const busyFirst = new Map(); // inbox file -> time of its first busy attempt
  let polling = false;
  every(1000, async () => {
    if (polling || !busNames.size) return;
    polling = true;
    try {
      for (const [name, sessionID] of busNames) {
        // Only the registered owner (this pid + this session) may consume the inbox.
        let reg; try { reg = JSON.parse(readFileSync(bus.busPaths(name).reg, 'utf8')); } catch {}
        if (reg?.pid !== process.pid || reg?.sessionID !== sessionID) continue;
        for (const m of bus.readInbox(name)) {
          // Claim atomically: with two live pollers (ownership handover) only one rename wins.
          const claim = `${m.file.slice(0, -'.json'.length)}.inflight`;
          try { renameSync(m.file, claim); } catch { continue; }
          // The gate checks this cache before any DB lookup; a stale human GO must not authorize a woken turn.
          sess(sessionID).prompt = '';
          try {
            let timer;
            const text = `[aos-bus from ${m.from}] ${m.text}`;
            const metadata = { aos_bus: { from: m.from, uid: m.uid, ts: m.ts } };
            const res = await Promise.race([input.client.session.prompt({
              path: { id: sessionID },
              query: directory ? { directory } : undefined,
              body: {
                noReply: !m.wake,
                // OpenCode 1.18.30: the TUI hides synthetic parts and the model never sees ignored
                // ones, so one copy each. Neither counts as a human turn (isHumanText).
                parts: [
                  { type: 'text', text, synthetic: true, metadata },
                  { type: 'text', text, ignored: true, metadata },
                ],
              },
            }), new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('aos-bus prompt timeout'), { timedOut: true })), BUS_PROMPT_TIMEOUT_MS); timer.unref?.(); })]).finally(() => clearTimeout(timer));
            if (res?.error) throw res.error;
            unlinkSync(claim);
            busyFirst.delete(m.file);
            input.client.tui?.showToast?.({ body: { title: 'aos-bus', message: `from ${m.from}`, variant: 'info', duration: 15000 } })?.catch?.(() => {});
          } catch (e) {
            // Busy: hand the file back and retry next tick, up to BUS_BUSY_MAX_MS after the first busy attempt.
            const isBusy = /busy/i.test(`${e?.name} ${e?.message} ${e?.data?.message}`);
            const first = busyFirst.get(m.file) ?? Date.now();
            if (isBusy) busyFirst.set(m.file, first);
            if (isBusy && Date.now() - first < BUS_BUSY_MAX_MS) { try { renameSync(claim, m.file); } catch {} break; }
            busyFirst.delete(m.file);
            // A timed-out prompt may still complete: delivery state unknown, so not .failed.
            try { renameSync(claim, `${m.file}${e?.timedOut ? '.timeout' : '.failed'}`); } catch {}
          }
        }
      }
    } catch {} finally { polling = false; }
  // ponytail: 1 s poll; fs.watch if latency matters. A wake turn is awaited, so it delays later messages until it ends.
  });
  const trail = (hook_event_name, session_id, extra = {}) =>
    void postTrail({ hook_event_name, session_id, cwd: directory, agent: 'opencode', ...extra });

  return {
    // W-6 loop-keeper. Fires whenever a session goes idle. Reads the graph
    // state and, while work is still open, prompts the session to continue.
    // Never throws: a graph that cannot be read must not wedge the session.
    event: async ({ event }) => {
      try {
        const props = (event && event.properties) || {};
        if (event?.type === 'session.created' && props.info?.id) {
          sess(props.info.id).parentID = props.info.parentID ?? null;
          trail('SessionStart', props.info.id);
          void ensureBus(props.info.id, props.info.parentID ?? null);
        } else if (event?.type === 'session.deleted' && props.info?.id) {
          dropBus(props.info.id);
        } else if (event?.type === 'permission.updated') {
          trail('Notification', props.sessionID, { message: props.title });
        } else if (event?.type === 'session.idle' && props.sessionID) {
          trail(sess(props.sessionID).parentID ? 'SubagentStop' : 'Stop', props.sessionID);
          void ensureBus(props.sessionID);
        }
      } catch {}

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
        // Synthetic + aos_loop: the nudge is plugin-written and must never count as a human turn (GO, gogate).
        await input.client.session.prompt({
          path: { id: sessionID },
          body: { parts: [{ type: 'text', text: buildGraphNudge(gate), synthetic: true, metadata: { aos_loop: { source: 'graph-gate', nudge: nudges + 1 } } }] },
          query: directory ? { directory } : undefined,
        });
      } catch {
        // Fail open. A graph gate that breaks the session is worse than no gate.
      }
    },

    'chat.message': async (msgInput, msgOutput) => {
      const textParts = (msgOutput.parts || []).filter(isHumanText);
      const fullText = textParts.map((p) => p.text).join('\n').trim();
      const s = sess(msgInput.sessionID);
      void ensureBus(msgInput.sessionID);
      s.prompt = fullText;
      // No human text (aos-bus pair, nudges): never a human GO, skip memB/pipeline/token.
      const parts = msgOutput.parts || [];
      const texts = parts.filter((p) => p && p.type === 'text');
      if ((parts.length > 0 && parts.every((p) => p && p.synthetic)) || (texts.length > 0 && texts.every(isNonHuman))) { s.prompt = ''; return; }

      try {
        if (!s.parentID) issueGoToken(fullText, { session_id: msgInput.sessionID, message_id: msgInput.messageID || msgOutput.message?.id });
      } catch {}

      // plain `gogate ...` message from the human in a root session: record it; the gate verifies it against opencode.db at use.
      try {
        const reply = s.parentID || OPENCODE_RUN ? null : applyGogate(fullText, { key: ocKey(msgInput.sessionID), source: `opencode:${msgInput.sessionID}`, uuid: msgInput.messageID || msgOutput.message?.id || null, opencode: true });
        if (reply) msgOutput.parts.unshift({ id: `gogate-${Date.now()}`, sessionID: msgInput.sessionID, messageID: msgInput.messageID || '', type: 'text', text: reply, synthetic: true });
      } catch {}

      try {
        const event = s.identitySent || s.parentID ? 'UserPromptSubmit' : 'SessionStart';
        s.identitySent = true;
        const membContext = await buildMemoryBlock({ event, prompt: fullText, cwd: directory });
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
        trail('PreToolUse', toolInput.sessionID, { tool_name, tool_input });
      } catch {}
      await trailAutostart(toolInput, directory, input.client);
      const toolName = (toolInput.tool || '').toLowerCase();
      // Intercept bash, terminal, or command execution tools
      if (toolName === 'bash' || toolName === 'terminal' || toolName === 'shell' || toolName === 'exec' || toolName === 'run_command') {
        const cmd = toolOutput?.args?.command || toolOutput?.args?.cmd || toolOutput?.args?.script || '';
        const bkey = ocKey(toolInput.sessionID);
        setGateContext({ cwd: directory, blockTs: readBlockTs(bkey) });
        const deny = (msg) => { markBlock(bkey); throw new Error(msg); };
        // Unconditional, before any GO, grant, mode or token.
        const hardReason = typeof cmd === 'string' ? hardBlockReason(cmd) : null;
        if (hardReason) deny(hardReason);
        const storeReason = gateStoreReason(cmd);
        if (storeReason) deny(storeReason);
        if (typeof cmd === 'string' && isGuardedCommand(cmd)) {
          const cooling = analyzeDeletes(cmd).cooldown;
          const s = sess(toolInput.sessionID);
          // An unanswered lookup is not proof of a root session: token-only for this call, not cached.
          let tokenOnly = !!s.parentID;
          if (!tokenOnly && input.client && toolInput.sessionID) {
            try {
              const res = await input.client.session.get({ path: { id: toolInput.sessionID } });
              if (res?.data) s.parentID = res.data.parentID ?? null;
              else tokenOnly = true;
            } catch { tokenOnly = true; }
            tokenOnly = tokenOnly || !!s.parentID;
          }
          // Subagent prompts are agent-written, so only a token or a grant can open their gate.
          const goOk = (text) => goAllows(parseGoText(text), cmd);
          let authorized = !tokenOnly && goOk(s.prompt);

          // If this session's cached prompt wasn't GO, query recent session messages via OpenCode client as fallback
          if (!authorized && !tokenOnly && input.client && toolInput.sessionID) {
            try {
              const res = await input.client.session.messages({ path: { id: toolInput.sessionID } });
              const msgs = res?.data || [];
              for (let i = msgs.length - 1; i >= 0; i--) {
                const m = msgs[i];
                if ((m.info?.role ?? m.role) === 'user') {
                  const parts = m.parts || [];
                  const text = parts.filter(isHumanText).map((p) => p.text).join('\n').trim();
                  authorized = goOk(text);
                  break;
                }
              }
            } catch {}
          }

          // Modes and grants of the root session (verified against opencode.db); usable by its subagents.
          if (!authorized && !cooling) {
            const root = await rootSessionId(input.client, toolInput.sessionID, tokenOnly ? undefined : s.parentID);
            if (root) {
              const key = ocKey(root);
              const eff = effectiveGate(key, { source: `opencode:${root}`, cmds: opencodeGogateCommands(root), opencode: true });
              for (const r of eff.rejected) gateLog(key, `rejected: ${r}`);
              if (eff.mode === 'soft' && grantsCover(cmd, eff.grants)) { // `off` is never honoured on OpenCode
                gateLog(key, `grant: allowed ${JSON.stringify(cmd.slice(0, 200))}`);
                authorized = true;
              }
            }
          }

          if (!authorized) {
            authorized = tokenGrantsGo(await ownSessionName(input.client, toolInput.sessionID)).ok;
          }

          if (!authorized) {
            deny(
              `${cooling ? COOLDOWN_MESSAGE + ' ' : ''}Blocked by BDB go-gate: Command "${cmd.slice(0, 80)}" is guarded and requires explicit authorization with the literal word "GO" before proceeding.`
            );
          }
        }
        const reason = checkConventionalCommit(cmd);
        if (reason) throw new Error(reason);
      } else if (['write', 'edit', 'multiedit', 'patch', 'apply_patch'].includes(toolName)) {
        const args = toolOutput?.args || {};
        const paths = [args.filePath ?? ''];
        for (const m of String(args.patchText ?? '').matchAll(/^\*\*\* (?:(?:Add|Update) File|Move to): (.+)$/gm)) paths.push(m[1].trim());
        for (const f of paths) {
          const reason = envFileReason(f);
          if (reason) throw new Error(reason);
        }
      }
    },

    'tool.execute.after': async (toolInput) => {
      try {
        const tool_input = pendingArgs.get(toolInput.callID);
        pendingArgs.delete(toolInput.callID);
        trail('PostToolUse', toolInput.sessionID, { tool_name: mapTrailToolName(toolInput.tool), tool_input });
      } catch {}
    },
  };
}
