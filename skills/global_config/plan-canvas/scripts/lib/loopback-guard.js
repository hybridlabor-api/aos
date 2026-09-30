'use strict';

/**
 * Host/Origin gating for ECC's loopback HTTP servers (control pane, plan
 * canvas). DNS rebinding can point an attacker-controlled hostname at
 * 127.0.0.1, so every request must present a Host header from this
 * allowlist before the server does any work.
 *
 * Source: affaan-m/ECC — MIT, see THIRD_PARTY_NOTICES.md
 */

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

module.exports = {
  LOOPBACK_HOSTNAMES,
  buildAllowedHostnames,
  isAllowedFetchSite,
  isAllowedHostHeader,
  isAllowedOrigin,
  parseHostHeader
};
