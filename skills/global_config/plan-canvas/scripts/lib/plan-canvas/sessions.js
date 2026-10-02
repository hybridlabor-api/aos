'use strict';

/**
 * Plan Canvas session store.
 *
 * Sessions are keyed by the canonical artifact file path so agents never
 * juggle opaque ids. State is persisted as JSON in the Plan Canvas state
 * dir so queued human feedback survives a server restart.
 *
 * Source: affaan-m/ECC — MIT, see THIRD_PARTY_NOTICES.md
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { normalizeAnnotation } = require('./annotation-schema');

const FEEDBACK_KINDS = new Set(['chat', 'annotation', 'verdict']);
const VERDICTS = new Set(['approve', 'request-changes']);

function resolveStateDir(env = process.env) {
  const override = env.AOS_PLAN_CANVAS_STATE_DIR;
  if (override && String(override).trim()) return path.resolve(String(override).trim());
  return path.join(os.homedir(), '.claude', 'aos-plan-canvas');
}

// Canonicalize so `./plan.md`, symlinks, and absolute paths all land on the
// same session.
function canonicalizeArtifactPath(filePath) {
  const absolute = path.resolve(filePath);
  try {
    return fs.realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function sessionKeyFor(canonicalPath) {
  return crypto.createHash('sha256').update(canonicalPath).digest('hex').slice(0, 12);
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeText(value, maxLength = 4000) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLength);
}

// Normalize one browser-submitted feedback item into the shape delivered to
// the agent. Returns null for unusable input rather than throwing so a
// malformed item can never wedge the queue.
function normalizeFeedbackItem(raw, counter, { origin = 'canvas', boundOrigin = null } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = FEEDBACK_KINDS.has(raw.kind) ? raw.kind : null;
  if (!kind) return null;
  // Only the canvas chrome can chat or approve; an app page may only annotate.
  if (origin === 'app' && kind !== 'annotation') return null;
  const item = {
    id: `fb-${counter}`,
    kind,
    text: sanitizeText(raw.text),
    at: nowIso()
  };
  if (kind === 'verdict') {
    if (!VERDICTS.has(raw.verdict)) return null;
    item.verdict = raw.verdict;
  }
  if (kind === 'annotation') {
    const fields = normalizeAnnotation(raw, { origin, boundOrigin });
    if (!fields) return null;
    Object.assign(item, fields);
  }
  if (kind === 'chat' && !item.text) return null;
  return item;
}

function createSessionStore({ stateDir = resolveStateDir() } = {}) {
  const stateFile = path.join(stateDir, 'sessions.json');
  let state = { sessions: {}, feedbackCounter: 0 };

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.sessions) {
        state = {
          sessions: parsed.sessions,
          feedbackCounter: Number(parsed.feedbackCounter) || 0
        };
      }
    } catch {
      // Missing or corrupt state starts fresh; queued feedback loss on a
      // corrupt file beats refusing to start at all.
    }
  }

  function persist() {
    fs.mkdirSync(stateDir, { recursive: true });
    const tmpFile = `${stateFile}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
    fs.renameSync(tmpFile, stateFile);
  }

  load();

  function get(key) {
    return state.sessions[key] || null;
  }

  function findByFile(filePath) {
    const canonical = canonicalizeArtifactPath(filePath);
    return get(sessionKeyFor(canonical));
  }

  // Open (or resume) a session. A session the *user* ended from the browser
  // is sticky: it refuses a plain reopen so agents do not pop the browser
  // back up uninvited. Pass reopen:true only when the human asked.
  function open(filePath, { reopen = false } = {}) {
    const canonical = canonicalizeArtifactPath(filePath);
    const key = sessionKeyFor(canonical);
    const existing = state.sessions[key];
    if (existing && existing.status === 'ended' && existing.endedBy === 'user' && !reopen) {
      return { session: existing, refused: true };
    }
    const session = existing || {
      key,
      file: canonical,
      chat: [],
      pendingFeedback: [],
      createdAt: nowIso()
    };
    // A token never outlives the session end: reopening needs a fresh one.
    if (existing && existing.status === 'ended') delete session.annotate;
    session.status = 'open';
    delete session.endedBy;
    session.updatedAt = nowIso();
    state.sessions[key] = session;
    persist();
    return { session, refused: false };
  }

  // Queue feedback from the browser. Chat-shaped items are mirrored into the
  // session transcript immediately so the conversation panel stays coherent
  // across reloads.
  function queueFeedback(key, rawItems, { endSession = false, origin = 'canvas', boundOrigin = null } = {}) {
    const session = get(key);
    if (!session || session.status === 'ended') return null;
    const accepted = [];
    const submitted = Array.isArray(rawItems) ? rawItems : [];
    for (const raw of submitted) {
      state.feedbackCounter += 1;
      const item = normalizeFeedbackItem(raw, state.feedbackCounter, { origin, boundOrigin });
      if (item) accepted.push(item);
    }
    session.pendingFeedback.push(...accepted);
    for (const item of accepted) {
      session.chat.push({ role: 'user', kind: item.kind, text: chatLineFor(item), at: item.at });
    }
    if (endSession) {
      session.status = 'ended';
      session.endedBy = 'user';
    } else if (accepted.length > 0) {
      session.status = 'feedback';
    }
    session.updatedAt = nowIso();
    persist();
    return { accepted, rejected: submitted.length - accepted.length, pending: session.pendingFeedback.length, session };
  }

  // Deliver-and-drain: feedback is handed to exactly one await call, after
  // which the session flips back to open. An ended session keeps reporting
  // ended (with attribution) so agents know to stop polling.
  function takeFeedback(key) {
    const session = get(key);
    if (!session) return { status: 'missing' };
    if (session.pendingFeedback.length > 0) {
      const items = session.pendingFeedback;
      session.pendingFeedback = [];
      const result = { status: 'feedback', items };
      if (session.status === 'ended') {
        result.sessionEnded = true;
        result.endedBy = session.endedBy;
      } else {
        session.status = 'open';
      }
      session.updatedAt = nowIso();
      persist();
      return result;
    }
    if (session.status === 'ended') {
      return { status: 'ended', endedBy: session.endedBy };
    }
    return { status: 'waiting' };
  }

  function setAnnotateToken(key, record) {
    const session = get(key);
    if (!session) return null;
    session.annotate = record;
    session.updatedAt = nowIso();
    persist();
    return record;
  }

  function getAnnotateToken(key) {
    const session = get(key);
    return (session && session.annotate) || null;
  }

  function addAgentReply(key, text) {
    const session = get(key);
    if (!session) return null;
    const entry = { role: 'agent', kind: 'chat', text: sanitizeText(text), at: nowIso() };
    session.chat.push(entry);
    session.updatedAt = nowIso();
    persist();
    return entry;
  }

  function end(key, endedBy) {
    const session = get(key);
    if (!session) return null;
    session.status = 'ended';
    session.endedBy = endedBy === 'user' ? 'user' : 'agent';
    session.updatedAt = nowIso();
    persist();
    return session;
  }

  function list() {
    return Object.values(state.sessions).map(session => ({
      key: session.key,
      file: session.file,
      status: session.status,
      endedBy: session.endedBy,
      pending: session.pendingFeedback.length,
      updatedAt: session.updatedAt
    }));
  }

  function hasOpenSessions() {
    return Object.values(state.sessions).some(session => session.status !== 'ended');
  }

  return {
    stateDir,
    stateFile,
    open,
    get,
    findByFile,
    queueFeedback,
    takeFeedback,
    setAnnotateToken,
    getAnnotateToken,
    addAgentReply,
    end,
    list,
    hasOpenSessions
  };
}

function appPathname(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '/';
  }
}

// One-line rendering of a feedback item for the conversation transcript.
function chatLineFor(item) {
  if (item.kind === 'verdict') {
    const label = item.verdict === 'approve' ? 'Approved the plan' : 'Requested changes';
    return item.text ? `${label}: ${item.text}` : label;
  }
  if (item.kind === 'annotation') {
    const where = item.anchor.snippet || item.anchor.selector || item.anchor.tag;
    const app = item.target && item.target.origin === 'app' ? `[app ${appPathname(item.target.url)}] ` : '';
    const types = item.shapes ? [...new Set(item.shapes.map(shape => shape.type))] : [];
    return `${app}[${where}] ${item.text}${types.length ? ` (${types.join(', ')})` : ''}`;
  }
  return item.text;
}

module.exports = {
  canonicalizeArtifactPath,
  createSessionStore,
  normalizeFeedbackItem,
  resolveStateDir,
  sessionKeyFor
};
