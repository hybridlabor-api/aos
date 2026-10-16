'use strict';
// Context profiles: a user-tunable axis that lowers start-of-session token cost.
// This module is read-only: it parses ~/.aos/v5-settings.json but never writes it.
const { sanitizeSettings, knownProfile, DEFAULT_PROFILE } = require('./profile');

const INSTALL_PROFILES = ['minimal', 'standard', 'full'];

// Estimates are based on the measured ~70k-token fresh empty session breakdown
// in docs/context-profiles.md. They are honest estimates, not guarantees.
const CONTEXT_PROFILES = {
  full: { label: 'Full context', estimate: 70000 },
  orchestrator: { label: 'Orchestrator', estimate: 55000 },
  worker: { label: 'Worker', estimate: 35000 },
  small: { label: 'Small model', estimate: 15000 },
};

const DEFAULT_CONTEXT_PROFILE = 'full';

const knownContextProfile = (x) => typeof x === 'string' && Object.hasOwn(CONTEXT_PROFILES, x);
const sanitizeContext = (raw) => (knownContextProfile(raw) ? raw : DEFAULT_CONTEXT_PROFILE);

/**
 * Parse the raw contents of ~/.aos/v5-settings.json into profile values.
 * This is the same logic `aos context` uses so the Control mod and CLI stay in sync.
 */
function parseSettings(text) {
  let raw;
  try {
    raw = JSON.parse(String(text || '{}').replace(/^\uFEFF/, ''));
  } catch {
    raw = {};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  const { settings } = sanitizeSettings(raw, null);
  return {
    installProfile: knownProfile(settings.profile) ? settings.profile : DEFAULT_PROFILE,
    contextProfile: sanitizeContext(settings.context),
  };
}

function readInstallProfile(home) {
  const { readSettings } = require('./profile');
  const settings = readSettings(home);
  return knownProfile(settings.profile) ? settings.profile : DEFAULT_PROFILE;
}

function readContextProfile(home) {
  const { readSettings } = require('./profile');
  const settings = readSettings(home);
  return sanitizeContext(settings.context);
}

function statusLine(home) {
  return `install: ${readInstallProfile(home)} · context: ${readContextProfile(home)} · estimate: ${tokenEstimate(readContextProfile(home))}`;
}

function tokenEstimate(name) {
  const n = CONTEXT_PROFILES[name]?.estimate;
  if (n === undefined) return 'unknown';
  return n >= 1000 ? `~${Math.round(n / 1000)}k` : `~${n}`;
}

function roleHint(sessionName = '') {
  const name = String(sessionName).toLowerCase();
  if (/master|orchestrator/.test(name)) return 'full/orchestrator';
  if (/worker/.test(name)) return 'worker';
  if (/small/.test(name)) return 'small';
  return '';
}

module.exports = {
  INSTALL_PROFILES,
  CONTEXT_PROFILES,
  DEFAULT_CONTEXT_PROFILE,
  parseSettings,
  readInstallProfile,
  readContextProfile,
  statusLine,
  tokenEstimate,
  roleHint,
  knownContextProfile,
  sanitizeContext,
};
