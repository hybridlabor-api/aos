'use strict';

/**
 * Host/Origin gating for ECC's loopback HTTP servers (control pane, plan
 * canvas). DNS rebinding can point an attacker-controlled hostname at
 * 127.0.0.1, so every request must present a Host header from this
 * allowlist before the server does any work.
 *
 * Source: affaan-m/ECC — MIT, see THIRD_PARTY_NOTICES.md
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

// Extract the hostname portion of an HTTP Host header value, stripping any
// port. Returns null when the header is missing or malformed.
function parseHostHeader(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
  if (!match) return null;
  if (match[2] !== undefined) {
    const port = Number(match[2]);
    if (!Number.isInteger(port) || port > 65535) return null;
  }
  return match[1].toLowerCase();
}

function buildAllowedHostnames(configuredHost) {
  const set = new Set(LOOPBACK_HOSTNAMES);
  if (configuredHost) set.add(String(configuredHost).toLowerCase());
  return set;
}

function isAllowedHostHeader(hostHeader, allowedHostnames) {
  const hostname = parseHostHeader(hostHeader);
  if (!hostname) return false;
  return allowedHostnames.has(hostname);
}

// Origin is absent on same-origin navigations and CLI clients; when present
// it must resolve to an allowed hostname. Loopback hostnames alone are not
// enough: any other local web app (another dev server on 127.0.0.1) would pass
// that test, so callers that know their port pass it and the origin must match
// it too.
function isAllowedOrigin(originHeader, allowedHostnames, allowedPort) {
  if (!originHeader || typeof originHeader !== 'string') return true;
  try {
    const url = new URL(originHeader);
    if (!allowedHostnames.has(url.hostname.toLowerCase())) return false;
    if (allowedPort === undefined || allowedPort === null) return true;
    const originPort = url.port || (url.protocol === 'https:' ? '443' : '80');
    return originPort === String(allowedPort);
  } catch {
    return false;
  }
}

// Browsers label every request with Sec-Fetch-Site. A cross-site or same-site
// request from another origin must never drive the canvas. Absent means a CLI
// client or an old browser; Origin still applies to those.
function isAllowedFetchSite(value) {
  if (!value || typeof value !== 'string') return true;
  const site = value.trim().toLowerCase();
  return site === 'same-origin' || site === 'none';
}

// Embedding is opt-in: the default is no ancestors. Preset an installer/CLI may write to ~/.aos/v5-settings.json.
const AO_EMBED_ANCESTORS = ['tauri://localhost', 'http://tauri.localhost'];

const EMBED_ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[a-z0-9.-]+(:\d{1,5})?$/;
const warnedEmbed = new Set();

function warnEmbed(msg) {
  if (warnedEmbed.has(msg)) return;
  warnedEmbed.add(msg);
  process.stderr.write(`[embed] ${msg}\n`);
}

function validEmbedOrigins(list, source) {
  const out = [];
  for (const item of list) {
    if (typeof item === 'string' && EMBED_ORIGIN.test(item)) out.push(item);
    else warnEmbed(`${source}: ignoring invalid embed origin ${JSON.stringify(item).slice(0, 60)}`);
  }
  return [...new Set(out)];
}

// Order: env AOS_EMBED_ANCESTORS (even empty) wins, else ~/.aos/v5-settings.json "embedAncestors", else [].
function embedAncestors(env = process.env, home = os.homedir()) {
  if (env && env.AOS_EMBED_ANCESTORS !== undefined) {
    const raw = String(env.AOS_EMBED_ANCESTORS).trim();
    return raw ? validEmbedOrigins(raw.split(',').map((x) => x.trim()).filter(Boolean), 'AOS_EMBED_ANCESTORS') : [];
  }
  try {
    const file = path.join(home, '.aos', 'v5-settings.json');
    const v = JSON.parse(fs.readFileSync(file, 'utf8')).embedAncestors;
    if (Array.isArray(v)) return validEmbedOrigins(v, file);
    if (v !== undefined) warnEmbed(`${file}: "embedAncestors" is not an array, ignored`);
  } catch { /* missing or unreadable settings: embedding stays off */ }
  return [];
}

function isEmbedNavigation(headers) {
  if (!headers || typeof headers !== 'object') return false;
  const dest = (headers['sec-fetch-dest'] || headers['Sec-Fetch-Dest'] || '').trim().toLowerCase();
  const mode = (headers['sec-fetch-mode'] || headers['Sec-Fetch-Mode'] || '').trim().toLowerCase();
  return dest === 'iframe' && mode === 'navigate';
}

function frameAncestors(ancestors) {
  return ancestors.length > 0 ? `frame-ancestors 'self' ${ancestors.join(' ')}` : "frame-ancestors 'none'";
}

// Adds the ancestors meta tag and the bridge script to an HTML page; no-op when embedding is off.
function injectEmbed(html, ancestors, src = '/ao-embed-bridge.js') {
  if (ancestors.length === 0) return html;
  const metaTag = `<meta name="ao-embed-ancestors" content="${ancestors.join(' ').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}">`;
  const inject = `${metaTag}\n<script src="${src}"></script>`;
  if (html.includes('</head>')) return html.replace('</head>', `${inject}\n</head>`);
  if (html.includes('<head>')) return html.replace('<head>', `<head>\n${inject}`);
  return `${inject}\n${html}`;
}

module.exports = {
  AO_EMBED_ANCESTORS,
  buildAllowedHostnames,
  embedAncestors,
  frameAncestors,
  injectEmbed,
  isAllowedFetchSite,
  isAllowedHostHeader,
  isAllowedOrigin,
  isEmbedNavigation
};
