'use strict';
// Token-like string redaction for log tails and any hub text that may carry
// secrets. Every pattern is replaced with a fixed placeholder.

const HEX64 = /\b[0-9a-f]{64}\b/gi;
const PATTERNS = [
  /\bghp_[A-Za-z0-9]+/g,
  /\bgho_[A-Za-z0-9]+/g,
  /\bghs_[A-Za-z0-9]+/g,
  /\bgithub_pat_[A-Za-z0-9_]+/g,
  /\bsk-[A-Za-z0-9_-]+/g,
  /\bxox[bp]-[A-Za-z0-9-]+/g,
  /\bAIza[0-9A-Za-z_-]+/g,
  /\bBearer[ \t]+[^\s"';,)}]+/gi,
];
const KEY_RE = /(TOKEN|SECRET|KEY|PASSWORD)/i;

export function redact(text) {
  let out = String(text ?? '');
  out = out.replace(HEX64, '[redacted-hex64]');
  for (const re of PATTERNS) out = out.replace(re, '[redacted]');
  // JWTs: three base64url parts, the first always starting 'eyJ' ({"…).
  out = out.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]');
  // URL userinfo: scheme://user:pass@host
  out = out.replace(/([a-z][a-z0-9+.-]*:\/\/)([^@/\s:]+):([^@/\s]+)@/gi, '$1[redacted]:[redacted]@');
  // Authorization headers: "Authorization: <scheme> <value>"
  out = out.replace(/\b(authorization\s*:\s*)([A-Za-z][A-Za-z0-9_-]*)\s+([^\s"';,)}]+)/gi, '$1$2 [redacted]');
  // Mid-line secret assignments (query strings `?token=…&`, argv
  // `--token=xyz`, json `"apikey": "…"`): only a secret-shaped key followed
  // by '=' or ':' carries a redactable value.
  out = out.replace(/((?:^|[\s,;{"'(\[&?~=])[^\s:=&/:]*?(?:token|apikey|api_key|secret|password)[^\s:=&/:]*)([:=]\s*)("?[^\s"'&,;}<>()]+)/gi, (m, k, sep) => `${k}${sep}[redacted]`);
  // Argv value pairs: `--api-key <value>`, `--token <value>`, `--token=<v>`.
  out = out.replace(/(^|\s)(--(?:api[-_]?key|apikey|api_key|token|secret|password))(=|\s+)("?[^\s"';,)}<>]+)/gi, (m, pre, flag, sep) => `${pre}${flag}${sep}[redacted]`);
  // KEY=value lines where the key looks secret-shaped (yaml, env, json-ish).
  out = out.split('\n').map((line) => {
    const m = line.match(/^(\s*"?)([A-Za-z0-9_.-]+)(\s*"?[:=]\s*"?)([^\s"].*)$/);
    if (m && KEY_RE.test(m[2])) return `${m[1]}${m[2]}${m[3]}[redacted]`;
    return line;
  }).join('\n');
  return out;
}
