'use strict';
// Token-like string redaction for log tails and any hub text that may carry
// secrets. Every pattern is replaced with a fixed placeholder.

const HEX64 = /\b[0-9a-f]{64}\b/gi;
const PATTERNS = [
  /\bghp_[A-Za-z0-9]{1,256}/g,
  /\bgho_[A-Za-z0-9]{1,256}/g,
  /\bghs_[A-Za-z0-9]{1,256}/g,
  /\bgithub_pat_[A-Za-z0-9_]{1,256}/g,
  /\bsk-[A-Za-z0-9_-]{1,256}/g,
  /\bxox[bp]-[A-Za-z0-9-]{1,256}/g,
  /\bAIza[0-9A-Za-z_-]{1,256}/g,
  /\bBearer[ \t]+[^\s"';,)}]{1,512}/gi,
];
const KEY_RE = /(TOKEN|SECRET|KEY|PASSWORD)/i;

// A single pathological line (64 KB of lowercase text, a 64 KB `token…`
// run) turns every global regex into an O(n^2) scan. Cap each line at
// REDACT_LINE_CAP characters before any pattern runs: the head AND the tail
// are kept (secrets and log tails sit at either end), only the middle is
// replaced with a marker.
const REDACT_LINE_CAP = 4096;
const capLine = (line) => (line.length > REDACT_LINE_CAP
  ? `${line.slice(0, REDACT_LINE_CAP / 2)}…[line truncated]${line.slice(-REDACT_LINE_CAP / 2)}`
  : line);

export function redact(text) {
  let out = String(text ?? '');
  out = out.split('\n').map(capLine).join('\n');
  out = out.replace(HEX64, '[redacted-hex64]');
  for (const re of PATTERNS) out = out.replace(re, '[redacted]');
  // JWTs: three base64url parts, the first always starting 'eyJ' ({"…).
  out = out.replace(/\beyJ[A-Za-z0-9_-]{1,4096}\.[A-Za-z0-9_-]{1,4096}\.[A-Za-z0-9_-]{1,4096}/g, '[redacted-jwt]');
  // URL userinfo: scheme://user:pass@host (anchored, bounded scheme length).
  out = out.replace(/\b([a-z][a-z0-9+.-]{0,31}:\/\/)([^@/\s:]+):([^@/\s]+)@/gi, '$1[redacted]:[redacted]@');
  // Authorization headers: "Authorization: <scheme> <value>"
  out = out.replace(/\b(authorization\s*:\s*)([A-Za-z][A-Za-z0-9_-]*)\s+([^\s"';,)}]{1,256})/gi, '$1$2 [redacted]');
  // Mid-line secret assignments (query strings `?token=…&`, argv
  // `--token=xyz`, json `"apikey": "…"`): only a secret-shaped key followed
  // by '=' or ':' carries a redactable value. Quantifiers are bounded so a
  // long non-matching key run cannot become quadratic.
  out = out.replace(/((?:^|[\s,;{"'(\[&?~=])[^\s:=&/:]{0,64}?(?:token|apikey|api_key|secret|password)[^\s:=&/:]{0,32})([:=]\s*)("?[^\s"'&,;}<>()]{1,256})/gi, (m, k, sep) => `${k}${sep}[redacted]`);
  // Argv value pairs: `--api-key <value>`, `--token <value>`, `--token=<v>`.
  out = out.replace(/(^|\s)(--(?:api[-_]?key|apikey|api_key|token|secret|password))(=|\s+)("?[^\s"';,)}<>]{1,256})/gi, (m, pre, flag, sep) => `${pre}${flag}${sep}[redacted]`);
  // KEY=value lines where the key looks secret-shaped (yaml, env, json-ish).
  out = out.split('\n').map((line) => {
    const m = line.match(/^(\s*"?)([A-Za-z0-9_.-]+)(\s*"?[:=]\s*"?)([^\s"].*)$/);
    if (m && KEY_RE.test(m[2])) return `${m[1]}${m[2]}${m[3]}[redacted]`;
    return line;
  }).join('\n');
  return out;
}
